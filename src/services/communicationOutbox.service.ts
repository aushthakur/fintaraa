import {
  CommunicationChannel,
  CommunicationOutbox,
  CommunicationOutboxStatus,
  type ICommunicationOutbox,
} from "../modals/communicationOutbox.model";
import {
  createDefaultMailOptions,
  createNewsletterMailOptions,
  sendMail,
} from "../utils/emailService";
import { NewsletterSubscription } from "../modals/newsletterSubscription.model";
import {
  sendInteraktTemplateMessage,
  type InteraktTemplatePayload,
} from "./interakt.service";
import { sendSMSMessage } from "../utils/smsService";

type EnqueueCommunicationInput = {
  channel: CommunicationChannel;
  eventName: string;
  referenceId?: string;
  recipient: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  maxAttempts?: number;
  nextAttemptAt?: Date;
};

type EmailOutboxPayload = {
  to: string;
  subject: string;
  html: string;
  newsletter?: boolean;
};

const BATCH_SIZE = 20;
const DEFAULT_INTERVAL_MS = 15_000;
const STALE_LOCK_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;

const errorMessage = (error: any) =>
  String(error?.response?.data?.message || error?.message || error || "Unknown error")
    .replace(/\s+/g, " ")
    .slice(0, 1000);

const providerMessageId = (response: any) =>
  String(
    response?.messageId ||
      response?.id ||
      response?.data?.messageId ||
      response?.data?.id ||
      "",
  ).trim();

const whatsappJobLogContext = (job: ICommunicationOutbox) => {
  const payload = job.payload as Partial<InteraktTemplatePayload>;
  return {
    jobId: String(job._id),
    eventName: job.eventName,
    referenceId: job.referenceId || "",
    to: `${payload?.countryCode || ""}${payload?.phoneNumber || ""}`,
    templateName: payload?.template?.name || "",
    callbackData: payload?.callbackData || "",
    idempotencyKey: job.idempotencyKey,
    attempt: job.attempts,
    maxAttempts: job.maxAttempts,
  };
};

export const enqueueCommunication = async (
  input: EnqueueCommunicationInput,
) => {
  const now = new Date();
  try {
    return await CommunicationOutbox.findOneAndUpdate(
      { idempotencyKey: input.idempotencyKey },
      {
        $setOnInsert: {
          channel: input.channel,
          eventName: input.eventName,
          referenceId: input.referenceId,
          recipient: input.recipient,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
          status: CommunicationOutboxStatus.PENDING,
          attempts: 0,
          maxAttempts: input.maxAttempts || 4,
          nextAttemptAt: input.nextAttemptAt || now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error: any) {
    if (error?.code === 11000) {
      return CommunicationOutbox.findOne({
        idempotencyKey: input.idempotencyKey,
      }).lean();
    }
    throw error;
  }
};

const deliverCommunication = async (job: ICommunicationOutbox) => {
  if (job.channel === CommunicationChannel.EMAIL) {
    const payload = job.payload as EmailOutboxPayload;
    if (!payload?.to || !payload?.subject || !payload?.html) {
      throw new Error("Email outbox payload is incomplete.");
    }
    if (payload.newsletter) {
      const isActive = await NewsletterSubscription.exists({
        email: payload.to.trim().toLowerCase(),
        status: "active",
      });
      if (!isActive) {
        return {
          messageId: "",
          providerStatus: "skipped_unsubscribed",
          skipped: true,
        };
      }
    }
    const info = await sendMail(
      payload.newsletter
        ? createNewsletterMailOptions(
            payload.to,
            payload.subject,
            payload.html,
          )
        : createDefaultMailOptions(payload.to, payload.subject, payload.html),
    );
    const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
    const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
    if (accepted.length === 0 || rejected.length > 0) {
      throw new Error(
        `SMTP rejected recipient${rejected.length ? `: ${rejected.join(", ")}` : ""}`,
      );
    }
    return {
      messageId: providerMessageId(info),
      providerStatus:
        String(info?.response || "").trim().slice(0, 500) || "accepted",
      skipped: false,
    };
  }

  if (job.channel === CommunicationChannel.WHATSAPP) {
    const payload = job.payload as InteraktTemplatePayload;
    const logContext = whatsappJobLogContext(job);
    console.log(
      "[CommunicationOutbox] WhatsApp sending to this number:",
      logContext,
    );
    const response = await sendInteraktTemplateMessage(payload);
    console.log("[CommunicationOutbox] WhatsApp provider accepted:", {
      ...logContext,
      providerMessageId: providerMessageId(response),
    });
    return {
      messageId: providerMessageId(response),
      providerStatus: "accepted",
      skipped: false,
    };
  }

  if (job.channel === CommunicationChannel.SMS) {
    const payload = job.payload as {
      to: string;
      message: string;
      templateId: string;
      variables?: Record<string, string | number>;
    };
    const response = await sendSMSMessage(payload);
    return {
      messageId: providerMessageId(
        response.success ? response.response : undefined,
      ),
      providerStatus: response.success ? "accepted" : response.reason,
      skipped: false,
    };
  }

  throw new Error(`Unsupported communication channel: ${job.channel}`);
};

const recoverStaleJobs = async () => {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  await CommunicationOutbox.updateMany(
    {
      status: CommunicationOutboxStatus.PROCESSING,
      lockedAt: { $lte: staleBefore },
    },
    {
      $set: {
        status: CommunicationOutboxStatus.PENDING,
        nextAttemptAt: new Date(),
        lastError: "Recovered after a stale worker lock.",
      },
      $unset: { lockedAt: 1 },
    },
  );
};

const claimNextJob = () =>
  CommunicationOutbox.findOneAndUpdate(
    {
      status: CommunicationOutboxStatus.PENDING,
      nextAttemptAt: { $lte: new Date() },
    },
    {
      $set: {
        status: CommunicationOutboxStatus.PROCESSING,
        lockedAt: new Date(),
      },
      $inc: { attempts: 1 },
    },
    {
      new: true,
      sort: { nextAttemptAt: 1, createdAt: 1 },
    },
  );

const markJobFailedOrRetry = async (
  job: ICommunicationOutbox,
  error: unknown,
) => {
  const hasAttemptsRemaining = job.attempts < job.maxAttempts;
  const retryIndex = Math.max(
    0,
    Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1),
  );
  const nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[retryIndex]);

  await CommunicationOutbox.updateOne(
    {
      _id: job._id,
      status: CommunicationOutboxStatus.PROCESSING,
    },
    {
      $set: {
        status: hasAttemptsRemaining
          ? CommunicationOutboxStatus.PENDING
          : CommunicationOutboxStatus.FAILED,
        nextAttemptAt,
        lastError: errorMessage(error),
      },
      $unset: { lockedAt: 1 },
    },
  );
};

export const processCommunicationOutbox = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await recoverStaleJobs();
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      const job = await claimNextJob();
      if (!job) break;

      try {
        const result = await deliverCommunication(job);
        await CommunicationOutbox.updateOne(
          {
            _id: job._id,
            status: CommunicationOutboxStatus.PROCESSING,
          },
          {
            $set: {
              status: result.skipped
                ? CommunicationOutboxStatus.CANCELLED
                : CommunicationOutboxStatus.SENT,
              ...(result.skipped ? {} : { sentAt: new Date() }),
              providerMessageId: result.messageId || undefined,
              providerStatus: result.providerStatus,
              lastError: "",
            },
            $unset: { lockedAt: 1 },
          },
        );
      } catch (error) {
        if (job.channel === CommunicationChannel.WHATSAPP) {
          console.log("[CommunicationOutbox] WhatsApp delivery failed:", {
            ...whatsappJobLogContext(job),
            error: errorMessage(error),
            willRetry: job.attempts < job.maxAttempts,
          });
        }
        await markJobFailedOrRetry(job, error);
      }
    }
  } catch (error) {
    console.error("[CommunicationOutbox] Worker error:", errorMessage(error));
  } finally {
    workerRunning = false;
  }
};

const asWebhookDate = (value: unknown) => {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

export const applyInteraktDeliveryWebhook = async (body: any) => {
  const eventType = String(body?.type || "").trim().toLowerCase();
  if (!eventType.startsWith("message_api_")) return null;

  const message = body?.data?.message || {};
  const callbackData = String(
    message?.meta_data?.source_data?.callback_data || "",
  ).trim();
  const messageId = String(message?.id || "").trim();
  const match = callbackData.match(/^loan:([^:]+):([^:]+)$/);
  const identityQueries: Record<string, any>[] = [];

  if (match) {
    identityQueries.push({
      idempotencyKey: `loan:${match[1]}:${match[2]}:whatsapp`,
    });
  }
  if (messageId) identityQueries.push({ providerMessageId: messageId });
  if (!identityQueries.length) return null;

  const statusByEvent: Record<string, CommunicationOutboxStatus> = {
    message_api_sent: CommunicationOutboxStatus.SENT,
    message_api_delivered: CommunicationOutboxStatus.DELIVERED,
    message_api_read: CommunicationOutboxStatus.READ,
    message_api_failed: CommunicationOutboxStatus.FAILED,
  };
  const nextStatus = statusByEvent[eventType];
  if (!nextStatus) return null;

  const allowedCurrentStatuses: Record<
    CommunicationOutboxStatus,
    CommunicationOutboxStatus[]
  > = {
    [CommunicationOutboxStatus.PENDING]: [],
    [CommunicationOutboxStatus.PROCESSING]: [],
    [CommunicationOutboxStatus.SENT]: [
      CommunicationOutboxStatus.PENDING,
      CommunicationOutboxStatus.PROCESSING,
      CommunicationOutboxStatus.SENT,
    ],
    [CommunicationOutboxStatus.DELIVERED]: [
      CommunicationOutboxStatus.PENDING,
      CommunicationOutboxStatus.PROCESSING,
      CommunicationOutboxStatus.SENT,
      CommunicationOutboxStatus.DELIVERED,
    ],
    [CommunicationOutboxStatus.READ]: [
      CommunicationOutboxStatus.PENDING,
      CommunicationOutboxStatus.PROCESSING,
      CommunicationOutboxStatus.SENT,
      CommunicationOutboxStatus.DELIVERED,
      CommunicationOutboxStatus.READ,
    ],
    [CommunicationOutboxStatus.FAILED]: [
      CommunicationOutboxStatus.PENDING,
      CommunicationOutboxStatus.PROCESSING,
      CommunicationOutboxStatus.SENT,
    ],
    [CommunicationOutboxStatus.CANCELLED]: [],
  };
  const eventAt = asWebhookDate(body?.timestamp);
  const set: Record<string, any> = {
    status: nextStatus,
    providerStatus:
      String(message?.message_status || "").trim().toLowerCase() ||
      nextStatus,
    providerMessageId: messageId || undefined,
  };

  if (nextStatus === CommunicationOutboxStatus.SENT) {
    set.sentAt = asWebhookDate(message?.received_at_utc || eventAt);
  }
  if (nextStatus === CommunicationOutboxStatus.DELIVERED) {
    set.deliveredAt = asWebhookDate(message?.delivered_at_utc || eventAt);
  }
  if (nextStatus === CommunicationOutboxStatus.READ) {
    set.deliveredAt = asWebhookDate(message?.delivered_at_utc || eventAt);
    set.readAt = asWebhookDate(message?.seen_at_utc || eventAt);
  }
  if (nextStatus === CommunicationOutboxStatus.FAILED) {
    set.lastError = errorMessage(
      message?.channel_failure_reason ||
        message?.channel_error_code ||
        "Interakt delivery failed.",
    );
  } else {
    set.lastError = "";
  }

  return CommunicationOutbox.findOneAndUpdate(
    {
      channel: CommunicationChannel.WHATSAPP,
      status: { $in: allowedCurrentStatuses[nextStatus] },
      $or: identityQueries,
    },
    {
      $set: set,
      $unset: { lockedAt: 1 },
    },
    { new: true },
  )
    .select("-payload")
    .lean();
};

export const startCommunicationOutboxWorker = () => {
  if (workerInterval) return workerInterval;
  const configuredInterval = Number(
    process.env.COMMUNICATION_OUTBOX_INTERVAL_MS || DEFAULT_INTERVAL_MS,
  );
  const intervalMs =
    Number.isFinite(configuredInterval) && configuredInterval >= 5_000
      ? configuredInterval
      : DEFAULT_INTERVAL_MS;

  void processCommunicationOutbox();
  workerInterval = setInterval(() => {
    void processCommunicationOutbox();
  }, intervalMs);
  workerInterval.unref();
  console.log(
    `[CommunicationOutbox] Worker started - checking every ${intervalMs}ms`,
  );
  return workerInterval;
};
