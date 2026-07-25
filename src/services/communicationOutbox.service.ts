import {
  CommunicationChannel,
  CommunicationOutbox,
  CommunicationOutboxStatus,
  type ICommunicationOutbox,
} from "../modals/communicationOutbox.model";
import {
  createDefaultMailOptions,
  sendMail,
} from "../utils/emailService";
import {
  sendInteraktTemplateMessage,
  type InteraktTemplatePayload,
} from "./interakt.service";

type EnqueueCommunicationInput = {
  channel: CommunicationChannel;
  eventName: string;
  referenceId?: string;
  recipient: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  maxAttempts?: number;
};

type EmailOutboxPayload = {
  to: string;
  subject: string;
  html: string;
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
          nextAttemptAt: now,
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
    const info = await sendMail(
      createDefaultMailOptions(payload.to, payload.subject, payload.html),
    );
    return {
      messageId: providerMessageId(info),
      providerStatus: "accepted",
    };
  }

  if (job.channel === CommunicationChannel.WHATSAPP) {
    const response = await sendInteraktTemplateMessage(
      job.payload as InteraktTemplatePayload,
    );
    return {
      messageId: providerMessageId(response),
      providerStatus: "accepted",
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
              status: CommunicationOutboxStatus.SENT,
              sentAt: new Date(),
              providerMessageId: result.messageId || undefined,
              providerStatus: result.providerStatus,
              lastError: "",
            },
            $unset: { lockedAt: 1 },
          },
        );
      } catch (error) {
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
