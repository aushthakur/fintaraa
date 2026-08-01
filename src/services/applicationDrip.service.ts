import { Types } from "mongoose";
import {
  CommunicationChannel,
  CommunicationOutbox,
  CommunicationOutboxStatus,
} from "../modals/communicationOutbox.model";
import { DripCampaign, IDripCampaignStep } from "../modals/dripCampaign.model";
import { User } from "../modals/user.model";
import { Agency } from "../modals/agency.model";
import { UserType } from "../modals/notification.model";
import { enqueueCommunication } from "./communicationOutbox.service";
import { sendSingleNotification } from "./notification.service";

type DripEvent = {
  _id?: Types.ObjectId | string;
  user: Types.ObjectId | string;
  formType: string;
  action: string;
  stepIndex?: number;
  totalSteps?: number;
  meta?: Record<string, any>;
};

const defaultEmailHtml = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Complete your Fintaraa application</title>
  </head>
  <body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#14213d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dce5f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#0f5b87;padding:24px 32px;">
                <div style="font-size:25px;font-weight:800;letter-spacing:.2px;color:#ffffff;">Fintaraa</div>
                <div style="margin-top:4px;font-size:13px;color:#d9efff;">Finance made simpler</div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 18px;">
                <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#eaf3ff;color:#175cd3;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;">Application pending</div>
                <h1 style="margin:18px 0 12px;font-size:28px;line-height:1.25;color:#102a43;">Complete your Fintaraa application</h1>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#486581;">Hi {{name}},</p>
                <p style="margin:0;font-size:16px;line-height:1.7;color:#486581;">Your <strong style="color:#102a43;">{{product}}</strong> application is still incomplete. Your saved information is secure, and you can continue from exactly where you left off.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 32px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7faff;border:1px solid #d9e7f5;border-radius:12px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <div style="font-size:13px;font-weight:700;color:#175cd3;text-transform:uppercase;letter-spacing:.35px;">Next step</div>
                      <div style="margin-top:7px;font-size:15px;line-height:1.55;color:#334e68;">Review the remaining details and submit your application for processing.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 34px;">
                <a href="{{url}}" style="display:inline-block;background:#1769e0;color:#ffffff;padding:14px 24px;border-radius:9px;text-decoration:none;font-size:15px;font-weight:700;">Resume application&nbsp;&nbsp;→</a>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#829ab1;">For your security, access your application only through the button above or by signing in directly at Fintaraa.</p>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e4ebf3;padding:22px 32px;background:#fbfcfe;">
                <p style="margin:0 0 7px;font-size:13px;line-height:1.55;color:#627d98;">Already completed your application? No action is needed; you can safely ignore this email.</p>
                <p style="margin:0;font-size:12px;line-height:1.55;color:#9aa9b8;">This is a service message related to your Fintaraa application.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export const ensureDefaultDripCampaign = async () =>
  DripCampaign.findOneAndUpdate(
    { trigger: "application_abandoned" },
    {
      $setOnInsert: {
        name: "Incomplete application recovery",
        trigger: "application_abandoned",
        isActive: true,
        steps: [
          {
            name: "First reminder",
            delayMinutes: 60,
            channels: [CommunicationChannel.EMAIL],
            emailSubject: "Action required: complete your {{product}} application",
            emailHtml: defaultEmailHtml,
            actionUrl: "/account/profile/applications",
          },
          {
            name: "Final reminder",
            delayMinutes: 1440,
            channels: [CommunicationChannel.EMAIL],
            emailSubject: "Your Fintaraa application is waiting",
            emailHtml: defaultEmailHtml,
            actionUrl: "/account/profile/applications",
          },
        ],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

const render = (value: string | undefined, variables: Record<string, string>) =>
  String(value || "").replace(
    /\{\{\s*(name|product|url)\s*\}\}/gi,
    (_, key: string) => variables[key.toLowerCase()] || "",
  );

const referenceFor = (event: DripEvent) => {
  const journeyId = String(
    event.meta?.journeyId ||
      `${event.formType}:${event.meta?.productSlug || "application"}`,
  ).slice(0, 180);
  return `application:${String(event.user)}:${journeyId}`;
};

const splitPhone = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  return {
    countryCode: "+91",
    phoneNumber: digits.length > 10 ? digits.slice(-10) : digits,
  };
};

const cancelPending = (referenceId: string) =>
  CommunicationOutbox.updateMany(
    {
      eventName: "application_abandoned_drip",
      referenceId,
      status: CommunicationOutboxStatus.PENDING,
    },
    {
      $set: {
        status: CommunicationOutboxStatus.CANCELLED,
        providerStatus: "cancelled_after_application_activity",
      },
    },
  );

export const resolveDripActorKind = (event: DripEvent) => {
  const value = String(
    event.meta?.actorRole ||
      event.meta?.actorKind ||
      (event.meta?.source === "b2b_app" ? "agency" : "user"),
  )
    .trim()
    .toLowerCase();
  return value === "agency" || value === "agency_member" ? value : "user";
};

const resolveDripRecipient = async (event: DripEvent) => {
  const actorKind = resolveDripActorKind(event);
  if (actorKind === "agency" || actorKind === "agency_member") {
    const agency = await Agency.findById(event.user)
      .select("name email mobile notification role status")
      .lean();
    return agency
      ? {
          profile: agency,
          role:
            agency.role === UserType.AGENCY_MEMBER
              ? UserType.AGENCY_MEMBER
              : UserType.AGENCY,
        }
      : null;
  }

  const user = await User.findById(event.user)
    .select("name email mobile notification status isDeleted")
    .lean();
  return user ? { profile: user, role: UserType.USER } : null;
};

const scheduleStep = async ({
  step,
  event,
  user,
  referenceId,
}: {
  step: IDripCampaignStep;
  event: DripEvent;
  user: any;
  referenceId: string;
}) => {
  const product = String(
    event.meta?.productName || event.meta?.productSlug || event.formType,
  )
    .replace(/[_-]+/g, " ")
    .trim();
  const baseUrl = String(
    process.env.PUBLIC_WEBSITE_URL || "https://fintaraa.com",
  ).replace(/\/+$/, "");
  const configuredUrl = String(
    event.meta?.resumeUrl ||
      step.actionUrl ||
      "/account/profile/applications",
  );
  const absoluteUrl = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `${baseUrl}/${configuredUrl.replace(/^\/+/, "")}`;
  const variables = {
    name: String(user.name || "Customer"),
    product: product || "loan",
    url: absoluteUrl,
  };
  const stepId = String(step._id || step.name)
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 80);
  const eventId = String(event._id || Date.now()).slice(-32);
  const nextAttemptAt = new Date(Date.now() + step.delayMinutes * 60_000);
  const jobs: Promise<any>[] = [];

  if (
    step.channels.includes(CommunicationChannel.EMAIL) &&
    user.email &&
    user.notification?.email !== false &&
    step.emailSubject &&
    step.emailHtml
  ) {
    jobs.push(
      enqueueCommunication({
        channel: CommunicationChannel.EMAIL,
        eventName: "application_abandoned_drip",
        referenceId,
        recipient: user.email,
        idempotencyKey: `drip:${referenceId}:${stepId}:email:${eventId}`,
        nextAttemptAt,
        payload: {
          to: user.email,
          subject: render(step.emailSubject, variables),
          html: render(step.emailHtml, variables),
        },
      }),
    );
  }

  if (
    step.channels.includes(CommunicationChannel.SMS) &&
    user.mobile &&
    user.notification?.sms !== false &&
    step.smsTemplateId &&
    step.smsMessage
  ) {
    jobs.push(
      enqueueCommunication({
        channel: CommunicationChannel.SMS,
        eventName: "application_abandoned_drip",
        referenceId,
        recipient: user.mobile,
        idempotencyKey: `drip:${referenceId}:${stepId}:sms:${eventId}`,
        nextAttemptAt,
        payload: {
          to: user.mobile,
          message: render(step.smsMessage, variables),
          templateId: step.smsTemplateId,
        },
      }),
    );
  }

  if (
    step.channels.includes(CommunicationChannel.WHATSAPP) &&
    user.mobile &&
    user.notification?.whatsapp !== false &&
    event.meta?.whatsappConsent === true &&
    step.whatsappTemplateName
  ) {
    const phone = splitPhone(user.mobile);
    jobs.push(
      enqueueCommunication({
        channel: CommunicationChannel.WHATSAPP,
        eventName: "application_abandoned_drip",
        referenceId,
        recipient: user.mobile,
        idempotencyKey: `drip:${referenceId}:${stepId}:whatsapp:${eventId}`,
        nextAttemptAt,
        payload: {
          ...phone,
          callbackData: `application_drip:${referenceId}:${stepId}`,
          type: "Template",
          template: {
            name: step.whatsappTemplateName,
            languageCode: "en",
            bodyValues: [variables.name, variables.product, variables.url],
          },
          metadata: {
            referenceId,
            product: variables.product,
            actionUrl: variables.url,
          },
        },
      }),
    );
  }
  await Promise.all(jobs);
};

export const scheduleApplicationDrip = async (event: DripEvent) => {
  const referenceId = referenceFor(event);
  await cancelPending(referenceId);
  if (event.action === "submitted") return;

  const [campaign, recipient] = await Promise.all([
    DripCampaign.findOne({
      trigger: "application_abandoned",
      isActive: true,
    }).lean(),
    resolveDripRecipient(event),
  ]);
  const user = recipient?.profile as any;
  if (!recipient || !user || user.isDeleted) return;

  const product = String(
    event.meta?.productName || event.meta?.productSlug || event.formType,
  )
    .replace(/[_-]+/g, " ")
    .trim();
  const missingFields = Array.isArray(event.meta?.missingFields)
    ? event.meta.missingFields.slice(0, 3).join(", ")
    : "";
  const jobs: Promise<any>[] = [];
  if (event.action === "profile_incomplete") {
    jobs.push(
      sendSingleNotification({
        type: "profile-incomplete",
        toUserId: String(event.user),
        toRole: recipient.role,
        context: {
          product: product || "application",
          missingFields,
        },
        dedupeKey: `profile-incomplete:${String(event._id || referenceId)}:${recipient.role}:${String(event.user)}`,
      }),
    );
  }
  if (campaign) {
    jobs.push(
      ...(((campaign as any).steps || []) as IDripCampaignStep[]).map((step) =>
        scheduleStep({ step, event, user, referenceId }),
      ),
    );
  }
  await Promise.all(jobs);
};
