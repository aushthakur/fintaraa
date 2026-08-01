import mongoose from "mongoose";
import firebaseAdmin from "../utils/firebase";
import { config } from "../config/config";
import { emitNotificationToUser } from "../config/socket.io";
import { Agency } from "../modals/agency.model";
import { Notification, UserType } from "../modals/notification.model";
import {
  IPushCampaign,
  IPushDelivery,
  PushCampaign,
  PushCampaignStatus,
  PushCampaignTarget,
  PushDelivery,
  PushDeliveryStatus,
} from "../modals/pushCampaign.model";
import { User } from "../modals/user.model";
import { WebPushSubscription } from "../modals/webPushSubscription.model";
import { sendWebPushToUser } from "./webPush.service";

type AudienceItem = {
  recipient: mongoose.Types.ObjectId;
  recipientRole: UserType;
  targets: Set<PushCampaignTarget>;
};

type CampaignInput = {
  title: string;
  message: string;
  type?: string;
  targets: PushCampaignTarget[];
  recipientIds?: string[];
  actionUrl?: string;
  scheduledAt?: Date;
  createdBy: string;
};

const BATCH_SIZE = 25;
const INTERVAL_MS = 10_000;
const STALE_LOCK_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];
const activeTokenQuery = {
  $or: [
    { fcmToken: { $exists: true, $nin: ["", null] } },
    {
      fcmTokens: {
        $elemMatch: {
          token: { $exists: true, $nin: ["", null] },
          active: { $ne: false },
        },
      },
    },
  ],
};

let workerRunning = false;
let workerInterval: NodeJS.Timeout | null = null;

const errorMessage = (error: unknown) =>
  String((error as any)?.message || error || "Unknown push error")
    .replace(/\s+/g, " ")
    .slice(0, 1800);

const asUserType = (value: unknown, fallback: UserType) => {
  const role = String(value || "") as UserType;
  return Object.values(UserType).includes(role) ? role : fallback;
};

const addAudience = (
  recipients: Map<string, AudienceItem>,
  recipient: mongoose.Types.ObjectId,
  role: UserType,
  target: PushCampaignTarget,
) => {
  const key = `${role}:${recipient}`;
  const item = recipients.get(key) || {
    recipient,
    recipientRole: role,
    targets: new Set<PushCampaignTarget>(),
  };
  item.targets.add(target);
  recipients.set(key, item);
};

export const resolvePushAudience = async (
  targets: PushCampaignTarget[],
  recipientIds?: string[],
) => {
  const selected = new Set(targets);
  const recipients = new Map<string, AudienceItem>();
  const hasExplicitRecipients = Array.isArray(recipientIds);
  const explicitRecipientIds = (recipientIds || [])
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const userScope = hasExplicitRecipients
    ? { _id: { $in: explicitRecipientIds } }
    : {};

  if (selected.has(PushCampaignTarget.B2C_APP)) {
    const users = await User.find({
      ...userScope,
      "notification.push": { $ne: false },
      ...activeTokenQuery,
    })
      .select("_id role")
      .lean();
    users.forEach((user) =>
      addAudience(
        recipients,
        user._id,
        asUserType(user.role, UserType.USER),
        PushCampaignTarget.B2C_APP,
      ),
    );
  }

  if (selected.has(PushCampaignTarget.B2B_APP)) {
    const agencies = hasExplicitRecipients
      ? []
      : await Agency.find({
          "notification.push": { $ne: false },
          ...activeTokenQuery,
        })
          .select("_id role")
          .lean();
    agencies.forEach((agency) =>
      addAudience(
        recipients,
        agency._id,
        asUserType(agency.role, UserType.AGENCY),
        PushCampaignTarget.B2B_APP,
      ),
    );
  }

  if (selected.has(PushCampaignTarget.WEBSITE)) {
    const subscriptions = await WebPushSubscription.find({
      active: true,
      ...(hasExplicitRecipients
        ? { user: { $in: explicitRecipientIds } }
        : {}),
    })
      .select("user role")
      .lean();
    const userIds = subscriptions
      .filter((item) => item.role === UserType.USER)
      .map((item) => item.user);
    const agencyIds = subscriptions
      .filter(
        (item) =>
          item.role === UserType.AGENCY ||
          item.role === UserType.AGENCY_MEMBER,
      )
      .map((item) => item.user);
    const [users, agencies] = await Promise.all([
      User.find({
        _id: { $in: userIds },
        "notification.push": { $ne: false },
      })
        .select("_id role")
        .lean(),
      hasExplicitRecipients
        ? Promise.resolve([])
        : Agency.find({
            _id: { $in: agencyIds },
            "notification.push": { $ne: false },
          })
            .select("_id role")
            .lean(),
    ]);
    users.forEach((user) =>
      addAudience(
        recipients,
        user._id,
        asUserType(user.role, UserType.USER),
        PushCampaignTarget.WEBSITE,
      ),
    );
    agencies.forEach((agency) =>
      addAudience(
        recipients,
        agency._id,
        asUserType(agency.role, UserType.AGENCY),
        PushCampaignTarget.WEBSITE,
      ),
    );
  }

  return recipients;
};

export const getPushCampaignOverview = async () => {
  const recipients = await resolvePushAudience(
    Object.values(PushCampaignTarget),
  );
  const counts: Record<PushCampaignTarget, number> = {
    [PushCampaignTarget.B2C_APP]: 0,
    [PushCampaignTarget.B2B_APP]: 0,
    [PushCampaignTarget.WEBSITE]: 0,
  };
  recipients.forEach((recipient) =>
    recipient.targets.forEach((target) => {
      counts[target] += 1;
    }),
  );
  return {
    counts,
    uniqueRecipients: recipients.size,
    providers: {
      notificationsEnabled: Boolean(config.notification?.enabled),
      firebaseReady: Boolean(firebaseAdmin.apps.length),
      webPushReady: Boolean(
        config.notification?.enabled &&
          config.notification?.vapid?.publicKey &&
          config.notification?.vapid?.privateKey &&
          config.notification?.vapid?.subject,
      ),
    },
  };
};

export const createPushCampaign = async (input: CampaignInput) => {
  const { recipientIds, ...campaignInput } = input;
  const scheduledAt =
    input.scheduledAt && input.scheduledAt.getTime() > Date.now()
      ? input.scheduledAt
      : new Date();
  const campaign = await PushCampaign.create({
    ...campaignInput,
    type: input.type || "admin-broadcast",
    scheduledAt,
    status: PushCampaignStatus.SCHEDULED,
  });
  try {
    const audience = await resolvePushAudience(input.targets, recipientIds);
    if (audience.size) {
      await PushDelivery.bulkWrite(
        Array.from(audience.values()).map((item) => ({
          updateOne: {
            filter: {
              campaign: campaign._id,
              recipient: item.recipient,
              recipientRole: item.recipientRole,
            },
            update: {
              $setOnInsert: {
                targets: Array.from(item.targets),
                deliveredTargets: [],
                status: PushDeliveryStatus.PENDING,
                attempts: 0,
                maxAttempts: 4,
                nextAttemptAt: scheduledAt,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
    campaign.totalRecipients = audience.size;
    campaign.pendingCount = audience.size;
    if (!audience.size) {
      campaign.status = PushCampaignStatus.COMPLETED;
      campaign.completedAt = new Date();
    }
    await campaign.save();
    return campaign;
  } catch (error) {
    await Promise.all([
      PushDelivery.deleteMany({ campaign: campaign._id }),
      PushCampaign.deleteOne({ _id: campaign._id }),
    ]);
    throw error;
  }
};

const getTokens = (recipient: any) => {
  const tokens = new Set<string>();
  if (recipient?.fcmToken) tokens.add(String(recipient.fcmToken).trim());
  (recipient?.fcmTokens || []).forEach((item: any) => {
    if (item?.active !== false && item?.token) {
      tokens.add(String(item.token).trim());
    }
  });
  return Array.from(tokens).filter(Boolean);
};

const resolveRecipient = (id: string, role: UserType) =>
  role === UserType.AGENCY || role === UserType.AGENCY_MEMBER
    ? Agency.findById(id).lean()
    : User.findById(id).lean();

const cleanupTokens = async (tokens: string[]) => {
  if (!tokens.length) return;
  const query = {
    $or: [
      { fcmToken: { $in: tokens } },
      { "fcmTokens.token": { $in: tokens } },
    ],
  };
  const update = {
    $unset: { fcmToken: "" },
    $pull: { fcmTokens: { token: { $in: tokens } } },
  };
  await Promise.all([
    User.updateMany(query, update),
    Agency.updateMany(query, update),
  ]);
};

const sendFcm = async (
  campaign: IPushCampaign,
  recipient: any,
  target: PushCampaignTarget,
  notificationId: string,
) => {
  if (!config.notification?.enabled) {
    throw new Error("Backend push notifications are disabled.");
  }
  if (!firebaseAdmin.apps.length) {
    throw new Error("Firebase Admin credentials are not configured.");
  }
  const tokens = getTokens(recipient);
  if (!tokens.length) throw new Error("No active FCM token remains.");
  const response = await firebaseAdmin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: campaign.title, body: campaign.message },
    data: {
      type: campaign.type,
      campaignId: String(campaign._id),
      notificationId,
      screen: "Notifications",
      url: campaign.actionUrl || "/",
      title: campaign.title,
      body: campaign.message,
    },
    android: {
      priority: "high",
      notification: {
        channelId:
          target === PushCampaignTarget.B2B_APP
            ? "fintaraa-default"
            : "fintaraa_updates",
        sound: "default",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
  });
  const invalid: string[] = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code || "";
    if (
      code.includes("registration-token-not-registered") ||
      code.includes("invalid-registration-token") ||
      code.includes("invalid-argument")
    ) {
      invalid.push(tokens[index]);
    }
  });
  await cleanupTokens(invalid);
  if (!response.successCount) {
    throw new Error(`Firebase rejected ${response.failureCount} token(s).`);
  }
  return {
    attempted: tokens.length,
    sent: response.successCount,
    failed: response.failureCount,
  };
};

const deliver = async (delivery: IPushDelivery) => {
  const [campaign, recipient] = await Promise.all([
    PushCampaign.findById(delivery.campaign),
    resolveRecipient(delivery.recipient.toString(), delivery.recipientRole),
  ]);
  if (!campaign || campaign.status === PushCampaignStatus.CANCELLED) {
    throw new Error("Campaign is cancelled or missing.");
  }
  if (!recipient) throw new Error("Recipient no longer exists.");
  if (recipient.notification?.push === false) {
    throw new Error("Recipient disabled push notifications.");
  }
  const notification = await Notification.findOneAndUpdate(
    {
      campaignId: campaign._id,
      "to.user": delivery.recipient,
      "to.role": delivery.recipientRole,
    },
    {
      $setOnInsert: {
        type: campaign.type,
        title: campaign.title,
        message: campaign.message,
        campaignId: campaign._id,
        data: { actionUrl: campaign.actionUrl || "", targets: campaign.targets },
        from: { user: campaign.createdBy, role: UserType.ADMIN },
        to: { user: delivery.recipient, role: delivery.recipientRole },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const alreadyDelivered = new Set(delivery.deliveredTargets || []);
  const successes: PushCampaignTarget[] = [];
  const failures: string[] = [];
  const summary = { ...(delivery.providerSummary || {}) };
  for (const target of delivery.targets.filter(
    (item) => !alreadyDelivered.has(item),
  )) {
    try {
      if (target === PushCampaignTarget.WEBSITE) {
        const result = await sendWebPushToUser({
          userId: delivery.recipient.toString(),
          role: delivery.recipientRole,
          payload: {
            title: campaign.title,
            body: campaign.message,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            data: {
              type: campaign.type,
              campaignId: String(campaign._id),
              notificationId: String(notification._id),
              url: campaign.actionUrl || "/",
            },
          },
        });
        summary[target] = result;
        if (!result.sent) throw new Error("No browser subscription accepted.");
      } else {
        summary[target] = await sendFcm(
          campaign,
          recipient,
          target,
          String(notification._id),
        );
      }
      successes.push(target);
    } catch (error) {
      failures.push(`${target}: ${errorMessage(error)}`);
    }
  }
  emitNotificationToUser(delivery.recipient.toString(), {
    title: campaign.title,
    body: campaign.message,
    type: campaign.type,
    campaignId: String(campaign._id),
    notificationId: String(notification._id),
    url: campaign.actionUrl || "/",
  });
  return { successes, failures, summary };
};

export const refreshPushCampaign = async (campaignId: string) => {
  const [campaign, groups] = await Promise.all([
    PushCampaign.findById(campaignId),
    PushDelivery.aggregate([
      { $match: { campaign: new mongoose.Types.ObjectId(campaignId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  if (!campaign) return null;
  const counts = Object.fromEntries(
    groups.map((item) => [item._id, item.count]),
  );
  campaign.pendingCount = counts[PushDeliveryStatus.PENDING] || 0;
  campaign.processingCount = counts[PushDeliveryStatus.PROCESSING] || 0;
  campaign.sentCount = counts[PushDeliveryStatus.SENT] || 0;
  campaign.failedCount = counts[PushDeliveryStatus.FAILED] || 0;
  campaign.cancelledCount = counts[PushDeliveryStatus.CANCELLED] || 0;
  if (campaign.status !== PushCampaignStatus.CANCELLED) {
    if (campaign.pendingCount + campaign.processingCount > 0) {
      campaign.status = campaign.processingCount
        ? PushCampaignStatus.PROCESSING
        : PushCampaignStatus.SCHEDULED;
      if (campaign.processingCount && !campaign.startedAt) {
        campaign.startedAt = new Date();
      }
      campaign.completedAt = undefined;
    } else {
      campaign.status = campaign.failedCount
        ? PushCampaignStatus.COMPLETED_WITH_ERRORS
        : PushCampaignStatus.COMPLETED;
      campaign.completedAt = new Date();
    }
  }
  return campaign.save();
};

const processDelivery = async (delivery: IPushDelivery) => {
  try {
    const result = await deliver(delivery);
    const deliveredTargets = Array.from(
      new Set([...(delivery.deliveredTargets || []), ...result.successes]),
    );
    const completed = delivery.targets.every((target) =>
      deliveredTargets.includes(target),
    );
    const retry = !completed && delivery.attempts < delivery.maxAttempts;
    const retryIndex = Math.min(
      Math.max(delivery.attempts - 1, 0),
      RETRY_DELAYS_MS.length - 1,
    );
    await PushDelivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: completed
            ? PushDeliveryStatus.SENT
            : retry
              ? PushDeliveryStatus.PENDING
              : PushDeliveryStatus.FAILED,
          deliveredTargets,
          providerSummary: result.summary,
          lastError: result.failures.join(" | "),
          nextAttemptAt: retry
            ? new Date(Date.now() + RETRY_DELAYS_MS[retryIndex])
            : delivery.nextAttemptAt,
          ...(completed ? { sentAt: new Date() } : {}),
        },
        $unset: { lockedAt: 1 },
      },
    );
  } catch (error) {
    const retry = delivery.attempts < delivery.maxAttempts;
    const retryIndex = Math.min(
      Math.max(delivery.attempts - 1, 0),
      RETRY_DELAYS_MS.length - 1,
    );
    await PushDelivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: retry
            ? PushDeliveryStatus.PENDING
            : PushDeliveryStatus.FAILED,
          nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MS[retryIndex]),
          lastError: errorMessage(error),
        },
        $unset: { lockedAt: 1 },
      },
    );
  } finally {
    await refreshPushCampaign(String(delivery.campaign));
  }
};

export const processPushCampaignQueue = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await PushDelivery.updateMany(
      {
        status: PushDeliveryStatus.PROCESSING,
        lockedAt: { $lte: new Date(Date.now() - STALE_LOCK_MS) },
      },
      {
        $set: {
          status: PushDeliveryStatus.PENDING,
          nextAttemptAt: new Date(),
          lastError: "Recovered stale worker lock.",
        },
        $unset: { lockedAt: 1 },
      },
    );
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      const delivery = await PushDelivery.findOneAndUpdate(
        {
          status: PushDeliveryStatus.PENDING,
          nextAttemptAt: { $lte: new Date() },
        },
        {
          $set: {
            status: PushDeliveryStatus.PROCESSING,
            lockedAt: new Date(),
          },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
      );
      if (!delivery) break;
      await processDelivery(delivery);
    }
  } catch (error) {
    console.error("[PushCampaign] Worker error:", errorMessage(error));
  } finally {
    workerRunning = false;
  }
};

export const cancelPushCampaign = async (id: string) => {
  const campaign = await PushCampaign.findOneAndUpdate(
    {
      _id: id,
      status: {
        $in: [PushCampaignStatus.SCHEDULED, PushCampaignStatus.PROCESSING],
      },
    },
    {
      $set: {
        status: PushCampaignStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    },
    { new: true },
  );
  if (!campaign) return null;
  await PushDelivery.updateMany(
    {
      campaign: campaign._id,
      status: {
        $in: [PushDeliveryStatus.PENDING, PushDeliveryStatus.PROCESSING],
      },
    },
    {
      $set: { status: PushDeliveryStatus.CANCELLED },
      $unset: { lockedAt: 1 },
    },
  );
  return refreshPushCampaign(id);
};

export const retryPushCampaign = async (id: string) => {
  const campaign = await PushCampaign.findOne({
    _id: id,
    status: PushCampaignStatus.COMPLETED_WITH_ERRORS,
  });
  if (!campaign) return null;
  const result = await PushDelivery.updateMany(
    { campaign: id, status: PushDeliveryStatus.FAILED },
    {
      $set: {
        status: PushDeliveryStatus.PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: "",
      },
      $unset: { lockedAt: 1, sentAt: 1 },
    },
  );
  if (!result.modifiedCount) return null;
  campaign.status = PushCampaignStatus.SCHEDULED;
  campaign.completedAt = undefined;
  await campaign.save();
  return refreshPushCampaign(id);
};

export const startPushCampaignWorker = () => {
  if (workerInterval) return;
  void processPushCampaignQueue();
  workerInterval = setInterval(
    () => void processPushCampaignQueue(),
    Math.max(
      5_000,
      Number(process.env.PUSH_CAMPAIGN_INTERVAL_MS || INTERVAL_MS),
    ),
  );
  workerInterval.unref();
  console.log("[PushCampaign] Sequential delivery worker started");
};
