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
  loanType: String(query?.loanType || "loan").replace(/_/g, " "),
  stage: stageLabels[query?.status] || String(query?.status || "").replace(/_/g, " "),
});

const getCustomerContact = (query: any) => ({
  email: query?.email || query?.customerId?.email || "",
  mobile: query?.mobile || query?.customerId?.mobile || "",
  name:
    `${query?.firstName || ""} ${query?.lastName || ""}`.trim() ||
    query?.customerId?.name ||
    "Customer",
});

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

const getDocumentUploadUrl = (query: any) => getTrackApplicationUrl(query);

const getContactAdvisorUrl = (query: any) => {
  const applicationId = getApplicationId(query);
  const text = encodeURIComponent(
    `Hi Fintaraa, I need help with loan application ${applicationId || ""}.`,
  );
  return `https://wa.me/918448282679?text=${text}`;
};

const getLoanEmailContext = (query: any, remarks?: string) => {
  const contact = getCustomerContact(query);
  return {
    name: contact.name,
    applicationId: getApplicationId(query) || "-",
    bankName: getLenderName(query),
    loanAmount: formatAmount(query?.loanAmount) || "—",
    disburseAmount:
      formatAmount(query?.disbursedAmount ?? query?.loanAmount) || "—",
    documentName: getRequestedDocuments(remarks),
    trackApplicationLink: getTrackApplicationUrl(query),
    websiteUrl: getDocumentUploadUrl(query),
    contactAdvisorLink: getContactAdvisorUrl(query),
  };
};

const queueLoanEmail = async (
  query: any,
  templateKey: LoanEmailTemplateKey,
  remarks?: string,
) => {
  const contact = getCustomerContact(query);
  if (!contact.email) return;
  const email = renderLoanEmail(
    templateKey,
    getLoanEmailContext(query, remarks),
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
) => {
  const contact = getCustomerContact(query);
  const hasWhatsappConsent =
    query?.whatsappConsent === true ||
    query?.communicationConsent?.whatsapp === true;
  if (
    !hasWhatsappConsent ||
    !contact.mobile ||
    !config.integrations.interakt.enabled
  )
    return;
  let template;
  try {
    template = getLoanWhatsappTemplate(templateKey, values);
  } catch (error: any) {
    console.log("Loan WhatsApp skipped:", error?.message || error);
    return;
  }
  const applicationId = getApplicationId(query);
  await enqueueCommunication({
    channel: CommunicationChannel.WHATSAPP,
    eventName: templateKey,
    referenceId: applicationId,
    recipient: contact.mobile,
    payload: {
      countryCode: config.integrations.interakt.defaultCountryCode,
      phoneNumber: contact.mobile,
      type: "Template",
      callbackData: `loan:${applicationId}:${templateKey}`,
      template,
    },
    idempotencyKey: `loan:${applicationId}:${templateKey}:whatsapp`,
  }).catch((error) =>
    console.log("Loan WhatsApp queue failed:", error?.message || error),
  );
};

export const notifyLoanApplicationCreated = async (queryOrId: any) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId loanId loanType email mobile firstName lastName whatsappConsent communicationConsent",
          )
          .populate("customerId", "name email mobile")
          .lean()
      : queryOrId;
  const customerId = query?.customerId?._id || query?.customerId;
  if (!customerId) return;

  await sendSingleNotification({
    type: "loan-application-created",
    toUserId: String(customerId),
    toRole: UserType.USER,
    context: getLoanNotificationContext(query),
  }).catch((error) =>
    console.log("Failed to send loan created notification:", error),
  );

  await queueLoanEmail(query, "applicationCreated");
  await queueLoanWhatsapp(query, "applicationCreated", [
    getCustomerContact(query).name,
    getApplicationId(query),
  ]);
};

export const notifyLoanStageUpdated = async (
  queryOrId: any,
  options: { remarks?: string } = {},
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId loanId loanType status email mobile firstName lastName bankName loanAmount disbursedAmount policyDetails whatsappConsent communicationConsent",
          )
          .populate("customerId", "name email mobile")
          .lean()
      : queryOrId;
  const customerId = query?.customerId?._id || query?.customerId;
  if (!customerId || !stageLabels[query?.status]) return;

  await sendSingleNotification({
    type: "loan-stage-updated",
    toUserId: String(customerId),
    toRole: UserType.USER,
    context: getLoanNotificationContext(query),
  }).catch((error) =>
    console.log("Failed to send loan stage notification:", error),
  );

  const templateKey = loanWhatsappTemplateForStatus(query.status);
  if (!templateKey) return;
  await queueLoanEmail(query, templateKey, options.remarks);

  const contact = getCustomerContact(query);
  const valuesByTemplate: Record<LoanWhatsappTemplateKey, unknown[]> = {
    applicationCreated: [contact.name, getApplicationId(query)],
    documentsRequired: [
      contact.name,
      getRequestedDocuments(options.remarks),
      getDocumentUploadUrl(query),
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
  await queueLoanWhatsapp(query, templateKey, valuesByTemplate[templateKey]);
};

export const notifyLoanDocumentsUploaded = async (
  queryOrId: any,
  documents: string[],
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select("customerId loanId loanType firstName lastName")
          .lean()
      : queryOrId;
  const customerId = query?.customerId?._id || query?.customerId;
  if (!customerId) return;

  await sendSingleNotification({
    type: "loan-documents-uploaded",
    toUserId: String(customerId),
    toRole: UserType.USER,
    context: {
      ...getLoanNotificationContext(query),
      name: `${query?.firstName || ""} ${query?.lastName || ""}`.trim(),
      documents: documents.join(", "),
    },
  }).catch((error) =>
    console.log("Failed to send document upload notification:", error),
  );
};
