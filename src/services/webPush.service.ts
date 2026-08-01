import { config } from "../config/config";
import webpush, { PushSubscription } from "web-push";
import { UserType } from "../modals/notification.model";
import { WebPushSubscription } from "../modals/webPushSubscription.model";
import { canonicalNotificationRole } from "./notificationRecipient.service";

type WebPushSubscriptionRecord = {
  _id?: any;
  user?: any;
  role?: UserType;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export class WebPushDeliveryError extends Error {
  statusCode?: number;
  permanent: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; permanent?: boolean } = {},
  ) {
    super(message);
    this.name = "WebPushDeliveryError";
    this.statusCode = options.statusCode;
    this.permanent = Boolean(options.permanent);
  }
}

const isVapidConfigured = () =>
  Boolean(
    config.notification?.vapid?.publicKey &&
    config.notification?.vapid?.privateKey &&
    config.notification?.vapid?.subject,
  );

const configureVapid = () => {
  if (!isVapidConfigured()) return false;

  webpush.setVapidDetails(
    config.notification.vapid.subject,
    config.notification.vapid.publicKey,
    config.notification.vapid.privateKey,
  );

  return true;
};

export const getVapidPublicKey = () =>
  config.notification?.vapid?.publicKey || "";

export const upsertWebPushSubscription = async ({
  role,
  userId,
  userAgent,
  subscription,
}: {
  userId: string;
  role: UserType;
  userAgent?: string;
  subscription: PushSubscription;
}) => {
  if (
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
  ) {
    throw new Error("Invalid web push subscription.");
  }

  const canonicalRole = await canonicalNotificationRole(userId, role);
  return WebPushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        user: userId,
        role: canonicalRole,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userAgent,
        active: true,
        lastUsedAt: new Date(),
        lastError: "",
        failureCount: 0,
      },
      $unset: { lastFailureAt: 1 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

export const removeWebPushSubscription = async ({
  userId,
  endpoint,
}: {
  userId: string;
  endpoint: string;
}) => {
  if (!endpoint) return null;

  return WebPushSubscription.findOneAndUpdate(
    { user: userId, endpoint },
    { active: false },
    { new: true },
  );
};

export const sendWebPushToSubscription = async ({
  subscription,
  payload,
}: {
  subscription: WebPushSubscriptionRecord;
  payload: Record<string, any>;
}) => {
  if (!config.notification?.enabled) {
    throw new WebPushDeliveryError("Push notifications are disabled.");
  }
  if (!configureVapid()) {
    throw new WebPushDeliveryError("VAPID is not configured.");
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
    );

    if (subscription._id) {
      await WebPushSubscription.updateOne(
        { _id: subscription._id },
        {
          $set: {
            active: true,
            lastUsedAt: new Date(),
            lastSuccessAt: new Date(),
            lastError: "",
          },
        },
      );
    }
    return { sent: true };
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.status || 0);
    const errorBody =
      typeof error?.body === "string"
        ? error.body
        : error?.body
          ? JSON.stringify(error.body)
          : "";
    const message = String(error?.message || errorBody || "Web push failed")
      .replace(/\s+/g, " ")
      .slice(0, 1000);
    const permanent = [400, 403, 404, 410].includes(statusCode);
    const isVapidMismatch =
      statusCode === 403 &&
      String(errorBody || message).toLowerCase().includes("vapid");

    if (subscription._id) {
      const failureFilter = isVapidMismatch
        ? {
            user: subscription.user,
            role: subscription.role,
            active: true,
          }
        : { _id: subscription._id };
      await WebPushSubscription.updateMany(failureFilter, {
        $set: {
          ...(permanent ? { active: false } : {}),
          lastFailureAt: new Date(),
          lastError: message,
        },
        $inc: { failureCount: 1 },
      });
    }

    throw new WebPushDeliveryError(message, {
      statusCode: statusCode || undefined,
      permanent,
    });
  }
};

export const sendWebPushToUser = async ({
  userId,
  role,
  payload,
}: {
  userId: string;
  role: UserType;
  payload: Record<string, any>;
}) => {
  if (!config.notification?.enabled || !configureVapid()) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  const canonicalRole = await canonicalNotificationRole(userId, role);
  const subscriptions = await WebPushSubscription.find({
    user: userId,
    role: canonicalRole,
    active: true,
  }).lean();

  if (!subscriptions.length) {
    console.log(
      `[WebPush] No active subscription for userId=${userId} role=${role}`,
    );
    return { attempted: 0, sent: 0, failed: 0 };
  }

  console.log(
    `\x1b[36m[WebPush] 🚀 Sending to ${subscriptions.length} subscription(s) userId=${userId} role=${role} title="${payload?.title || ""}" url="${payload?.data?.url || ""}"\x1b[0m`,
  );

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sendWebPushToSubscription({ subscription, payload });
        console.log(
          `\x1b[32m[WebPush] ✅ Sent userId=${userId} role=${role} endpoint=${String(subscription.endpoint || "").slice(0, 80)}\x1b[0m`,
        );
        return true;
      } catch (error: any) {
        const statusCode = error?.statusCode;
        const endpointPreview = String(subscription.endpoint || "").slice(
          0,
          80,
        );
        if (error instanceof WebPushDeliveryError && error.permanent) {
          console.log(
            `\x1b[33m[WebPush] ⚠️ Disabled invalid subscription userId=${userId} status=${statusCode || "unknown"} endpoint=${endpointPreview} message=${error.message}\x1b[0m`,
          );
          return false;
        }

        console.log(
          `\x1b[31m[WebPush] ❌ Failed userId=${userId} status=${statusCode || "unknown"} endpoint=${endpointPreview}: ${error?.message || error}\x1b[0m`,
        );
        return false;
      }
    }),
  );

  const sent = results.filter(Boolean).length;
  return {
    attempted: subscriptions.length,
    sent,
    failed: subscriptions.length - sent,
  };
};
