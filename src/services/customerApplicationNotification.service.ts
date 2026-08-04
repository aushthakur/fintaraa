import { config } from "../config/config";
import { CommunicationChannel } from "../modals/communicationOutbox.model";
import { renderLightTransactionalEmail } from "../utils/transactionalEmailTemplate";
import { enqueueCommunication } from "./communicationOutbox.service";

export type ApplicationCommunicationKind = "loan" | "insurance";

export type CustomerApplicationCommunication = {
  kind: ApplicationCommunicationKind;
  applicationId: string;
  customerId?: string;
  customerName?: string;
  email?: string;
  mobile?: string;
  whatsappConsent?: boolean;
  productName: string;
  status: string;
  previousStatus?: string;
  remarks?: string;
  eventKey?: string;
  documentName?: string;
  actionUrl?: string;
  channels?: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
  };
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const formatApplicationStatus = (value: unknown) =>
  String(value || "updated")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const getWebsiteBaseUrl = () =>
  String(config.publicWebsiteUrl || "https://fintaraa.com").replace(/\/+$/, "");

export const getApplicationTrackingUrl = (applicationId: string) =>
  `${getWebsiteBaseUrl()}/application-status?applicationId=${encodeURIComponent(applicationId)}`;

export const getCustomerDocumentUploadUrl = () =>
  `${getWebsiteBaseUrl()}/account/profile/uploaded-documents`;

const normalizeEventKey = (input: CustomerApplicationCommunication) =>
  String(
    input.eventKey ||
      `${input.status}:${input.documentName || "status"}:${Date.now()}`,
  )
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .slice(0, 180);

const getApplicationWhatsappLogContext = (
  input: CustomerApplicationCommunication,
  eventKey: string,
) => ({
  kind: input.kind,
  applicationId: input.applicationId,
  status: input.status,
  eventKey,
  to: input.mobile || "",
  hasWhatsappConsent: input.whatsappConsent === true,
  whatsappChannelEnabled: input.channels?.whatsapp !== false,
  interaktEnabled: config.integrations.interakt.enabled,
});

const buildEmail = (input: CustomerApplicationCommunication) => {
  const name = escapeHtml(input.customerName || "Customer");
  const applicationId = escapeHtml(input.applicationId);
  const productName = escapeHtml(input.productName);
  const status = escapeHtml(formatApplicationStatus(input.status));
  const actionUrl =
    input.actionUrl || getApplicationTrackingUrl(input.applicationId);
  const isDocumentRequest = Boolean(input.documentName);
  const documentName = escapeHtml(input.documentName || "required document");
  const remarks = input.remarks
    ? `<p style="margin:12px 0 0"><strong>Note:</strong> ${escapeHtml(input.remarks)}</p>`
    : "";

  const subject = isDocumentRequest
    ? `Document re-upload required for ${input.applicationId}`
    : `${input.productName} application status: ${formatApplicationStatus(input.status)}`;
  const heading = isDocumentRequest
    ? "Document re-upload required"
    : "Your application status was updated";
  const description = isDocumentRequest
    ? `Please upload a new copy of <strong>${documentName}</strong> for application <strong>${applicationId}</strong>.`
    : `Your <strong>${productName}</strong> application <strong>${applicationId}</strong> is now <strong>${status}</strong>.`;
  const buttonLabel = isDocumentRequest ? "Upload document" : "Track application";

  return {
    subject,
    html: renderLightTransactionalEmail({
      preheader: isDocumentRequest
        ? `A document is required for application ${input.applicationId}.`
        : `${input.productName} application ${input.applicationId} is now ${formatApplicationStatus(input.status)}.`,
      eyebrow: `${input.kind} application update`,
      title: heading,
      body: `
        <p>Hi ${name},</p>
        <p>${description}</p>
        ${remarks}
      `,
      action: { label: buttonLabel, href: actionUrl },
    }),
  };
};

const queueEmail = async (
  input: CustomerApplicationCommunication,
  eventKey: string,
) => {
  if (!input.email || input.channels?.email === false) return;
  const email = buildEmail(input);
  await enqueueCommunication({
    channel: CommunicationChannel.EMAIL,
    eventName: input.documentName
      ? "application-document-reupload-requested"
      : "application-status-updated",
    referenceId: input.applicationId,
    recipient: input.email,
    payload: {
      to: input.email,
      subject: email.subject,
      html: email.html,
    },
    idempotencyKey: `application:${input.kind}:${input.applicationId}:${eventKey}:email`,
  });
};

const queueSms = async (
  input: CustomerApplicationCommunication,
  eventKey: string,
) => {
  if (!input.mobile || input.channels?.sms === false || !config.sms.enabled) return;
  const notificationConfig = config.applicationNotifications;
  const isDocumentRequest = Boolean(input.documentName);
  const templateId = isDocumentRequest
    ? notificationConfig.documentReuploadSmsTemplateId
    : notificationConfig.statusSmsTemplateId;
  const message = isDocumentRequest
    ? notificationConfig.documentReuploadSmsMessage
    : notificationConfig.statusSmsMessage;
  if (!templateId || !message) return;

  const actionUrl =
    input.actionUrl || getApplicationTrackingUrl(input.applicationId);
  await enqueueCommunication({
    channel: CommunicationChannel.SMS,
    eventName: isDocumentRequest
      ? "application-document-reupload-requested"
      : "application-status-updated",
    referenceId: input.applicationId,
    recipient: input.mobile,
    payload: {
      to: input.mobile,
      message,
      templateId,
      variables: {
        name: input.customerName || "Customer",
        applicationId: input.applicationId,
        product: input.productName,
        status: formatApplicationStatus(input.status),
        document: input.documentName || "",
        url: actionUrl,
      },
    },
    idempotencyKey: `application:${input.kind}:${input.applicationId}:${eventKey}:sms`,
  });
};

const queueWhatsapp = async (
  input: CustomerApplicationCommunication,
  eventKey: string,
) => {
  const logContext = getApplicationWhatsappLogContext(input, eventKey);
  console.log("[Application WhatsApp] Template hit:", logContext);
  if (!input.whatsappConsent) {
    console.log(
      "[Application WhatsApp] Skipped - WhatsApp consent missing:",
      logContext,
    );
    return;
  }
  if (!input.mobile) {
    console.log("[Application WhatsApp] Skipped - mobile number missing:", logContext);
    return;
  }
  if (input.channels?.whatsapp === false) {
    console.log("[Application WhatsApp] Skipped - channel disabled:", logContext);
    return;
  }
  if (!config.integrations.interakt.enabled) {
    console.log("[Application WhatsApp] Skipped - Interakt disabled:", logContext);
    return;
  }
  const notificationConfig = config.applicationNotifications;
  const isDocumentRequest = Boolean(input.documentName);
  const templateName = isDocumentRequest
    ? notificationConfig.whatsappDocumentReuploadTemplate
    : notificationConfig.whatsappStatusTemplate;
  if (!templateName) {
    console.log("[Application WhatsApp] Skipped - template name missing:", {
      ...logContext,
      isDocumentRequest,
    });
    return;
  }

  const actionUrl =
    input.actionUrl || getApplicationTrackingUrl(input.applicationId);
  const bodyValues = isDocumentRequest
    ? [
        input.customerName || "Customer",
        input.documentName || "Required document",
        input.applicationId,
        actionUrl,
      ]
    : [
        input.customerName || "Customer",
        input.productName,
        input.applicationId,
        formatApplicationStatus(input.status),
        actionUrl,
      ];
  const callbackData = `application:${input.kind}:${input.applicationId}:${eventKey}`;
  const idempotencyKey = `application:${input.kind}:${input.applicationId}:${eventKey}:whatsapp`;
  console.log(
    "[Application WhatsApp] Queueing template - sending to this number when worker runs:",
    {
      ...logContext,
      templateName,
      languageCode: notificationConfig.whatsappLanguage,
      bodyValues,
      callbackData,
      idempotencyKey,
    },
  );
  const queued = await enqueueCommunication({
    channel: CommunicationChannel.WHATSAPP,
    eventName: isDocumentRequest
      ? "application-document-reupload-requested"
      : "application-status-updated",
    referenceId: input.applicationId,
    recipient: input.mobile,
    payload: {
      countryCode: config.integrations.interakt.defaultCountryCode,
      phoneNumber: input.mobile,
      type: "Template",
      callbackData,
      template: {
        name: templateName,
        languageCode: notificationConfig.whatsappLanguage,
        bodyValues,
      },
    },
    idempotencyKey,
  });
  console.log("[Application WhatsApp] Queued template:", {
    ...logContext,
    templateName,
    idempotencyKey,
    outboxStatus: (queued as any)?.status,
  });
};

export const queueCustomerApplicationCommunications = async (
  input: CustomerApplicationCommunication,
) => {
  const eventKey = normalizeEventKey(input);
  const results = await Promise.allSettled([
    queueEmail(input, eventKey),
    queueSms(input, eventKey),
    queueWhatsapp(input, eventKey),
  ]);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const channel = ["email", "sms", "whatsapp"][index];
      console.log(
        `[Application Notification] ${channel} queue failed:`,
        result.reason?.message || result.reason,
      );
    }
  });
};
