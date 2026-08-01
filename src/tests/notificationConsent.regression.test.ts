import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Admin from "../modals/admin.model";
import Agent from "../modals/agent.model";
import { Notification, UserType } from "../modals/notification.model";
import {
  normalizeApplicationCommunicationConsent,
  requiresApplicationWhatsappConsent,
  resolveConsentActorModel,
} from "../services/communicationConsent.service";
import {
  getReminderWindow,
  REMINDER_CATCH_UP_MINUTES,
  REMINDER_MINUTES_BEFORE,
} from "../services/callbackReminder.service";
import {
  canonicalNotificationRole,
  notificationRoleAliases,
} from "../services/notificationRecipient.service";
import { resolveDripActorKind } from "../services/applicationDrip.service";
import {
  getAllNotifications,
  getNotificationStats,
} from "../services/notification.service";

test("callback scheduler covers T-15 and catches up recently missed reminders", () => {
  const now = new Date("2026-08-01T06:30:00.000Z");
  const window = getReminderWindow(now);

  assert.equal(
    window.start.toISOString(),
    new Date(
      now.getTime() - REMINDER_CATCH_UP_MINUTES * 60_000,
    ).toISOString(),
  );
  assert.equal(window.now, now);
  assert.equal(
    window.end.toISOString(),
    new Date(now.getTime() + REMINDER_MINUTES_BEFORE * 60_000).toISOString(),
  );
});

test("external submitted applications require explicit WhatsApp consent", () => {
  assert.equal(
    requiresApplicationWhatsappConsent({
      status: "submitted",
      source: "b2c_app",
      role: "user",
    }),
    true,
  );
  assert.equal(
    requiresApplicationWhatsappConsent({
      status: "draft",
      source: "b2c_app",
      role: "user",
    }),
    false,
  );
  assert.equal(
    requiresApplicationWhatsappConsent({
      status: "submitted",
      source: "unknown",
      role: "user",
    }),
    true,
  );
  assert.equal(
    requiresApplicationWhatsappConsent({
      status: "submitted",
      role: "agency_member",
    }),
    true,
  );
  assert.equal(
    requiresApplicationWhatsappConsent({
      status: "submitted",
      source: "website",
      role: "admin",
    }),
    false,
  );
});

test("application consent records normalized source, timestamp, and evidence text", () => {
  const normalized = normalizeApplicationCommunicationConsent({
    whatsappConsent: "yes",
    communicationConsent: JSON.stringify({
      email: true,
      consentText: "Explicit consent text",
      consentedAt: "2026-08-01T05:00:00.000Z",
    }),
    source: "b2b_app",
    formSource: "b2b_loan_application",
  });

  assert.equal(normalized.whatsapp, true);
  assert.equal(normalized.details.whatsapp, true);
  assert.equal(normalized.details.email, true);
  assert.equal(normalized.details.source, "b2b_app");
  assert.equal(normalized.details.formSource, "b2b_loan_application");
  assert.equal(normalized.details.consentText, "Explicit consent text");
  assert.equal(normalized.details.consentedAt, "2026-08-01T05:00:00.000Z");
  assert.equal(resolveConsentActorModel("agency_member"), "Agency");
  assert.equal(resolveConsentActorModel("user"), "User");
});

test("manager-style staff roles resolve to their persisted admin inbox", async (t) => {
  const originalAdminExists = Admin.exists;
  const originalAgentExists = Agent.exists;
  (Admin as any).exists = async () => ({ _id: new Types.ObjectId() });
  (Agent as any).exists = async () => null;
  t.after(() => {
    (Admin as any).exists = originalAdminExists;
    (Agent as any).exists = originalAgentExists;
  });

  const userId = new Types.ObjectId().toString();
  assert.equal(
    await canonicalNotificationRole(userId, "manager"),
    UserType.ADMIN,
  );
  assert.equal(
    await canonicalNotificationRole(userId, UserType.AGENT),
    UserType.ADMIN,
  );
  assert.deepEqual(await notificationRoleAliases(userId, "manager"), [
    UserType.ADMIN,
    UserType.AGENT,
    "manager",
  ]);
  assert.deepEqual(await notificationRoleAliases(userId, UserType.AGENT), [
    UserType.ADMIN,
    UserType.AGENT,
  ]);
});

test("notification dedupe keys and B2B drip identities remain stable", () => {
  const notification = new Notification({
    type: "follow-up-reminder",
    title: "Follow-up due",
    message: "Callback in 15 minutes",
    dedupeKey: "callback:record-1:agent:agent-1",
    to: { user: new Types.ObjectId(), role: UserType.AGENT },
  });

  assert.equal(notification.validateSync(), undefined);
  assert.equal(notification.dedupeKey, "callback:record-1:agent:agent-1");
  assert.equal(
    resolveDripActorKind({
      user: new Types.ObjectId(),
      formType: "business_loan",
      action: "profile_incomplete",
      meta: { source: "b2b_app", actorRole: "agency_member" },
    }),
    "agency_member",
  );
});

test("notification inbox and stats cannot be redirected to another user", async () => {
  const actorId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();
  const makeResponse = () => {
    const response: any = {
      statusCode: 200,
      body: null,
      status(code: number) {
        response.statusCode = code;
        return response;
      },
      json(body: unknown) {
        response.body = body;
        return response;
      },
    };
    return response;
  };
  const next = (error?: unknown) => {
    if (error) throw error;
  };
  const request = {
    user: { _id: actorId, role: UserType.USER },
    query: { user: otherUserId },
  } as any;

  const inboxResponse = makeResponse();
  await getAllNotifications(request, inboxResponse, next);
  assert.equal(inboxResponse.statusCode, 403);

  const statsResponse = makeResponse();
  await getNotificationStats(request, statsResponse, next);
  assert.equal(statsResponse.statusCode, 403);
});
