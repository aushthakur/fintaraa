import { config } from "../config/config";
import webpush, { PushSubscription } from "web-push";
import { UserType } from "../modals/notification.model";
import { WebPushSubscription } from "../modals/webPushSubscription.model";

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

  return WebPushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: userId,
      role,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent,
      active: true,
      lastUsedAt: new Date(),
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

export const sendWebPushToUser = async ({
  userId,
  role,
  payload,
}: {
  userId: string;
  role: UserType;
  payload: Record<string, any>;
}) => {
  if (!config.notification?.enabled || !configureVapid()) return;

  const subscriptions = await WebPushSubscription.find({
    user: userId,
    role,
    active: true,
  }).lean();

  if (!subscriptions.length) {
    console.log(
      `[WebPush] No active subscription for userId=${userId} role=${role}`,
    );
    return;
  }

  console.log(
    `\x1b[36m[WebPush] 🚀 Sending to ${subscriptions.length} subscription(s) userId=${userId} role=${role} title="${payload?.title || ""}" url="${payload?.data?.url || ""}"\x1b[0m`,
  );

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          JSON.stringify(payload),
        );

        await WebPushSubscription.updateOne(
          { _id: subscription._id },
          { lastUsedAt: new Date() },
        );
        console.log(
          `\x1b[32m[WebPush] ✅ Sent userId=${userId} role=${role} endpoint=${String(subscription.endpoint || "").slice(0, 80)}\x1b[0m`,
        );
      } catch (error: any) {
        const statusCode = error?.statusCode || error?.status;
        const endpointPreview = String(subscription.endpoint || "").slice(
          0,
          80,
        );
        const errorBody =
          typeof error?.body === "string"
            ? error.body
            : error?.body
              ? JSON.stringify(error.body)
              : "";

        if ([400, 403, 404, 410].includes(Number(statusCode))) {
          const isVapidMismatch =
            Number(statusCode) === 403 &&
            String(errorBody || error?.message || "")
              .toLowerCase()
              .includes("vapid");
          const disableFilter = isVapidMismatch
            ? { user: userId, role, active: true }
            : { _id: subscription._id };
          await WebPushSubscription.updateMany(disableFilter, {
            active: false,
          });
          console.log(
            `\x1b[33m[WebPush] ⚠️ Disabled ${isVapidMismatch ? "all user" : "single"} subscription(s) userId=${userId} status=${statusCode || "unknown"} endpoint=${endpointPreview} message=${error?.message || ""} body=${errorBody}\x1b[0m`,
          );
          return;
        }

        console.log(
          `\x1b[31m[WebPush] ❌ Failed userId=${userId} status=${statusCode || "unknown"} endpoint=${endpointPreview}: ${error?.message || error} ${errorBody}\x1b[0m`,
        );
      }
    }),
  );
};
