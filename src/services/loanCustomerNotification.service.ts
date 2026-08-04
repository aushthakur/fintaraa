import { LoanQuery } from "../modals/loanquery.model";
import { UserType } from "../modals/notification.model";
import { ApplicationStatus } from "../modals/insurancequery.model";
import { sendSingleNotification } from "./notification.service";
import { config } from "../config/config";
import { CommunicationChannel } from "../modals/communicationOutbox.model";
import { enqueueCommunication } from "./communicationOutbox.service";
import {
  getLoanWhatsappTemplate,
  LoanWhatsappTemplateKey,
  loanWhatsappTemplateForStatus,
} from "../config/whatsappTemplates";
import {
  renderLoanEmail,
  type LoanEmailTemplateKey,
} from "./loanEmailTemplates.service";
import {
  syncReferralFromLoanStage,
  trackReferralApplication,
} from "./referral.service";
import {
  getCustomerDocumentUploadUrl,
  queueCustomerApplicationCommunications,
} from "./customerApplicationNotification.service";
import { getLoanTypeDisplayLabel } from "../utils/loanType";
import { Agency } from "../modals/agency.model";
import { User } from "../modals/user.model";

const stageLabels: Record<string, string> = {
  [ApplicationStatus.LOGIN_DONE]: "Login",
  [ApplicationStatus.LOGIN_APPROVED]: "Login Approved",
  [ApplicationStatus.SANCTIONED]: "Sanction",
  [ApplicationStatus.DISBURSED]: "Disbursement",
  [ApplicationStatus.DISBURSED_PARTIAL_FULL]: "Disbursement",
  [ApplicationStatus.DOCUMENTS_REQUESTED]: "Documents Requested",
  [ApplicationStatus.REJECTED]: "Rejected",
  [ApplicationStatus.REJECTED_BY_BANK]: "Rejected by Bank",
};

const getLoanNotificationContext = (query: any) => ({
  loanId: query?.loanId || query?._id?.toString?.() || "",
  loanType: getLoanTypeDisplayLabel(query?.loanType, query?.policyDetails),
  stage: stageLabels[query?.status] || String(query?.status || "").replace(/_/g, " "),
});

const getCustomerContact = (query: any, recipient?: any) => ({
  email: query?.email || recipient?.email || query?.customerId?.email || "",
  mobile: query?.mobile || recipient?.mobile || query?.customerId?.mobile || "",
  name:
    `${query?.firstName || ""} ${query?.lastName || ""}`.trim() ||
    recipient?.name ||
    query?.customerId?.name ||
    "Customer",
});

const isAgencyLoanApplication = (query: any) =>
  Boolean(query?.channelAgency || query?.ownerAgency) ||
  String(query?.dataSource || "").trim().toLowerCase() === "b2b_app";

export const resolveLoanNotificationRecipient = async (query: any) => {
  if (!query) return null;
  if (isAgencyLoanApplication(query)) {
    const agencyId =
      query?.channelAgency?._id ||
      query?.channelAgency ||
      query?.customerId?._id ||
      query?.customerId;
    if (!agencyId) return null;
    const agency = await Agency.findById(agencyId)
      .select("name email mobile role")
      .lean();
    if (!agency) return null;
    return {
      id: String(agency._id),
      role:
        agency.role === UserType.AGENCY_MEMBER
          ? UserType.AGENCY_MEMBER
          : UserType.AGENCY,
      profile: agency,
    };
  }

  const userId = query?.customerId?._id || query?.customerId;
  if (!userId) return null;
  const profile =
    query?.customerId?.email || query?.customerId?.mobile
      ? query.customerId
      : await User.findById(userId).select("name email mobile").lean();
  if (!profile) return null;
  return { id: String(userId), role: UserType.USER, profile };
};

const getApplicationId = (query: any) =>
  String(query?.loanId || query?._id?.toString?.() || "").trim();

const getLenderName = (query: any) =>
  String(
    query?.policyDetails?.preferredBank ||
      query?.bankName ||
      "our lending partner",
  ).trim();

const formatAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount)
    : "";
};

const getLoanWhatsappLogContext = (
  query: any,
  templateKey: LoanWhatsappTemplateKey | undefined,
  contact: ReturnType<typeof getCustomerContact>,
) => ({
  applicationId: getApplicationId(query),
  status: query?.status || "application_created",
  loanType: getLoanNotificationContext(query).loanType,
  templateKey: templateKey || null,
  to: contact.mobile || "",
  hasWhatsappConsent:
    query?.whatsappConsent === true ||
    query?.communicationConsent?.whatsapp === true,
  interaktEnabled: config.integrations.interakt.enabled,
});

const getRequestedDocuments = (remarks?: string) => {
  const value = String(remarks || "").replace(/^Requested documents:\s*/i, "").trim();
  return value || "Required loan documents";
};

const getPublicWebsiteBaseUrl = () =>
  String(config.publicWebsiteUrl || "https://fintaraa.com").replace(/\/+$/, "");

const getTrackApplicationUrl = (query: any) => {
  const applicationId = getApplicationId(query);
  const params = applicationId
    ? `?applicationId=${encodeURIComponent(applicationId)}`
    : "";
  return `${getPublicWebsiteBaseUrl()}/application-status${params}`;
};

const getDocumentUploadUrl = () => getCustomerDocumentUploadUrl();

const getContactAdvisorUrl = (query: any) => {
  const applicationId = getApplicationId(query);
  const text = encodeURIComponent(
    `Hi Fintaraa, I need help with loan application ${applicationId || ""}.`,
  );
  return `https://wa.me/918448282679?text=${text}`;
};

const getLoanEmailContext = (query: any, remarks?: string, recipient?: any) => {
  const contact = getCustomerContact(query, recipient);
  return {
    name: contact.name,
    applicationId: getApplicationId(query) || "-",
    loanType: getLoanNotificationContext(query).loanType,
    bankName: getLenderName(query),
    loanAmount: formatAmount(query?.loanAmount) || "—",
    disburseAmount:
      formatAmount(query?.disbursedAmount ?? query?.loanAmount) || "—",
    documentName: getRequestedDocuments(remarks),
    trackApplicationLink: getTrackApplicationUrl(query),
    websiteUrl: getDocumentUploadUrl(),
    contactAdvisorLink: getContactAdvisorUrl(query),
  };
};

const queueLoanEmail = async (
  query: any,
  templateKey: LoanEmailTemplateKey,
  remarks?: string,
  recipient?: any,
) => {
  const contact = getCustomerContact(query, recipient);
  if (!contact.email) return;
  const email = renderLoanEmail(
    templateKey,
    getLoanEmailContext(query, remarks, recipient),
  );
  const applicationId = getApplicationId(query);
  await enqueueCommunication({
    channel: CommunicationChannel.EMAIL,
    eventName: templateKey,
    referenceId: applicationId,
    recipient: contact.email,
    payload: {
      to: contact.email,
      subject: email.subject,
      html: email.html,
    },
    idempotencyKey: `loan:${applicationId}:${templateKey}:email`,
  }).catch((error) =>
    console.log("Loan email queue failed:", error?.message || error),
  );
};

const queueLoanWhatsapp = async (
  query: any,
  templateKey: LoanWhatsappTemplateKey,
  values: unknown[],
  recipient?: any,
) => {
  const contact = getCustomerContact(query, recipient);
  const applicationId = getApplicationId(query);
  const hasWhatsappConsent =
    query?.whatsappConsent === true ||
    query?.communicationConsent?.whatsapp === true;
  const logContext = getLoanWhatsappLogContext(query, templateKey, contact);
  console.log("[Loan WhatsApp] Template hit:", logContext);
  if (!hasWhatsappConsent) {
    console.log("[Loan WhatsApp] Skipped - WhatsApp consent missing:", logContext);
    return;
  }
  if (!contact.mobile) {
    console.log("[Loan WhatsApp] Skipped - mobile number missing:", logContext);
    return;
  }
  if (!config.integrations.interakt.enabled) {
    console.log("[Loan WhatsApp] Skipped - Interakt disabled:", logContext);
    return;
  }
  let template;
  try {
    template = getLoanWhatsappTemplate(templateKey, values);
  } catch (error: any) {
    console.log("[Loan WhatsApp] Skipped - template values invalid:", {
      ...logContext,
      error: error?.message || error,
    });
    return;
  }
  const callbackData = `loan:${applicationId}:${templateKey}`;
  const idempotencyKey = `loan:${applicationId}:${templateKey}:whatsapp`;
  console.log(
    "[Loan WhatsApp] Queueing template - sending to this number when worker runs:",
    {
      ...logContext,
      templateName: template.name,
      languageCode: template.languageCode,
      bodyValues: template.bodyValues,
      callbackData,
      idempotencyKey,
    },
  );
  const queued = await enqueueCommunication({
    channel: CommunicationChannel.WHATSAPP,
    eventName: templateKey,
    referenceId: applicationId,
    recipient: contact.mobile,
    payload: {
      countryCode: config.integrations.interakt.defaultCountryCode,
      phoneNumber: contact.mobile,
      type: "Template",
      callbackData,
      template,
    },
    idempotencyKey,
  }).catch((error) => {
    console.log("[Loan WhatsApp] Queue failed:", {
      ...logContext,
      templateName: template.name,
      error: error?.message || error,
    });
    return null;
  });
  if (queued) {
    console.log("[Loan WhatsApp] Queued template:", {
      ...logContext,
      templateName: template.name,
      idempotencyKey,
      outboxStatus: (queued as any)?.status,
    });
  }
};

export const notifyLoanApplicationCreated = async (queryOrId: any) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId channelAgency ownerAgency dataSource loanId loanType policyDetails.productVariant policyDetails.metaFlowKey policyDetails.requestedProductName policyDetails.requestedProductSlug policyDetails.productLabel email mobile firstName lastName whatsappConsent communicationConsent",
          )
          .lean()
      : queryOrId;
  const recipient = await resolveLoanNotificationRecipient(query);

  if (recipient?.role === UserType.USER) {
    await trackReferralApplication(recipient.id, query).catch((error) =>
      console.log("Referral application tracking failed:", error),
    );
  }

  if (recipient) {
    await sendSingleNotification({
      type: "loan-application-created",
      toUserId: recipient.id,
      toRole: recipient.role,
      context: getLoanNotificationContext(query),
      dedupeKey: `loan:${getApplicationId(query)}:application-created:app:${recipient.role}:${recipient.id}`,
    }).catch((error) =>
      console.log("Failed to send loan created notification:", error),
    );
  }

  await queueLoanEmail(query, "applicationCreated", undefined, recipient?.profile);
  await queueLoanWhatsapp(query, "applicationCreated", [
    getCustomerContact(query, recipient?.profile).name,
    getApplicationId(query),
  ], recipient?.profile);
  const contact = getCustomerContact(query, recipient?.profile);
  await queueCustomerApplicationCommunications({
    kind: "loan",
    applicationId: getApplicationId(query),
    customerId: recipient?.id,
    customerName: contact.name,
    email: contact.email,
    mobile: contact.mobile,
    whatsappConsent:
      query?.whatsappConsent === true ||
      query?.communicationConsent?.whatsapp === true,
    productName: getLoanNotificationContext(query).loanType,
    status: "submitted",
    eventKey: "application-created",
    channels: { email: false, whatsapp: false, sms: true },
  });
};

export const notifyLoanStageUpdated = async (
  queryOrId: any,
  options: { remarks?: string } = {},
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId channelAgency ownerAgency dataSource loanId loanType status email mobile firstName lastName bankName loanAmount disbursedAmount policyDetails whatsappConsent communicationConsent updatedAt",
          )
          .lean()
      : queryOrId;
  const recipient = await resolveLoanNotificationRecipient(query);

  if (recipient?.role === UserType.USER) {
    await syncReferralFromLoanStage(query).catch((error) =>
      console.log("Referral stage tracking failed:", error),
    );
  }
  if (recipient) {
    await sendSingleNotification({
      type: "loan-stage-updated",
      toUserId: recipient.id,
      toRole: recipient.role,
      context: getLoanNotificationContext(query),
      dedupeKey: `loan:${getApplicationId(query)}:stage:${query?.status}:app:${recipient.role}:${recipient.id}`,
    }).catch((error) =>
      console.log("Failed to send loan stage notification:", error),
    );
  }

  const templateKey = loanWhatsappTemplateForStatus(query.status);
  const contact = getCustomerContact(query, recipient?.profile);
  console.log("[Loan WhatsApp] Stage status checked:", {
    ...getLoanWhatsappLogContext(query, templateKey, contact),
    loanSpecificWhatsappTemplate: Boolean(templateKey),
    genericApplicationWhatsappPath: !templateKey,
  });
  const documentsRequested =
    query.status === ApplicationStatus.DOCUMENTS_REQUESTED
      ? getRequestedDocuments(options.remarks)
      : undefined;
  await queueCustomerApplicationCommunications({
    kind: "loan",
    applicationId: getApplicationId(query),
    customerId: recipient?.id,
    customerName: contact.name,
    email: contact.email,
    mobile: contact.mobile,
    whatsappConsent:
      query?.whatsappConsent === true ||
      query?.communicationConsent?.whatsapp === true,
    productName: getLoanNotificationContext(query).loanType,
    status: query.status,
    remarks: options.remarks,
    documentName: documentsRequested,
    actionUrl: documentsRequested ? getDocumentUploadUrl() : undefined,
    eventKey: `${query.status}:${query?.updatedAt?.getTime?.() || query?.updatedAt || "latest"}`,
    channels: {
      email: !templateKey,
      whatsapp: !templateKey,
      sms: true,
    },
  });
  if (!templateKey) {
    console.log("[Loan WhatsApp] No loan-specific template mapped for status:", {
      ...getLoanWhatsappLogContext(query, templateKey, contact),
      status: query?.status,
    });
    return;
  }

  const valuesByTemplate: Record<LoanWhatsappTemplateKey, unknown[]> = {
    applicationCreated: [contact.name, getApplicationId(query)],
    documentsRequired: [
      contact.name,
      getRequestedDocuments(options.remarks),
      getDocumentUploadUrl(),
    ],
    bankLoginSuccess: [contact.name, getLenderName(query), getApplicationId(query)],
    loanSanctioned: [
      contact.name,
      formatAmount(query?.loanAmount) || "—",
      getLenderName(query),
    ],
    loanDisbursed: [
      contact.name,
      formatAmount(query?.disbursedAmount ?? query?.loanAmount) || "—",
      getLenderName(query),
    ],
    applicationRejected: [contact.name, getLenderName(query)],
  };
  await Promise.all([
    queueLoanEmail(query, templateKey, options.remarks, recipient?.profile),
    queueLoanWhatsapp(
      query,
      templateKey,
      valuesByTemplate[templateKey],
      recipient?.profile,
    ),
  ]);
};

export const notifyLoanDocumentReuploadRequested = async (
  queryOrId: any,
  documentName: string,
  remarks?: string,
  eventKey?: string,
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId channelAgency ownerAgency dataSource loanId loanType policyDetails.productVariant policyDetails.metaFlowKey policyDetails.requestedProductName policyDetails.requestedProductSlug policyDetails.productLabel status email mobile firstName lastName whatsappConsent communicationConsent updatedAt",
          )
          .lean()
      : queryOrId;
  const recipient = await resolveLoanNotificationRecipient(query);
  if (!recipient) return;
  const contact = getCustomerContact(query, recipient.profile);
  await queueCustomerApplicationCommunications({
    kind: "loan",
    applicationId: getApplicationId(query),
    customerId: recipient.id,
    customerName: contact.name,
    email: contact.email,
    mobile: contact.mobile,
    whatsappConsent:
      query?.whatsappConsent === true ||
      query?.communicationConsent?.whatsapp === true,
    productName: getLoanNotificationContext(query).loanType,
    status: "documents_requested",
    documentName,
    remarks,
    actionUrl: getDocumentUploadUrl(),
    eventKey:
      eventKey ||
      `reupload:${documentName}:${query?.updatedAt?.getTime?.() || Date.now()}`,
  });
};

export const notifyLoanDocumentsUploaded = async (
  queryOrId: any,
  documents: string[],
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId channelAgency ownerAgency dataSource loanId loanType policyDetails.productVariant policyDetails.metaFlowKey policyDetails.requestedProductName policyDetails.requestedProductSlug policyDetails.productLabel firstName lastName",
          )
          .lean()
      : queryOrId;
  const recipient = await resolveLoanNotificationRecipient(query);
  if (!recipient) return;

  await sendSingleNotification({
    type: "loan-documents-uploaded",
    toUserId: recipient.id,
    toRole: recipient.role,
    context: {
      ...getLoanNotificationContext(query),
      name: `${query?.firstName || ""} ${query?.lastName || ""}`.trim(),
      documents: documents.join(", "),
    },
  }).catch((error) =>
    console.log("Failed to send document upload notification:", error),
  );
};
