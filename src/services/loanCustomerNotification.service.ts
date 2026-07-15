import { LoanQuery } from "../modals/loanquery.model";
import { UserType } from "../modals/notification.model";
import { ApplicationStatus } from "../modals/insurancequery.model";
import { sendSingleNotification } from "./notification.service";
import { createDefaultMailOptions, sendMail } from "../utils/emailService";
import { sendInteraktTemplateMessage } from "./interakt.service";
import { config } from "../config/config";
import {
  getLoanWhatsappTemplate,
  LoanWhatsappTemplateKey,
  loanWhatsappTemplateForStatus,
} from "../config/whatsappTemplates";

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
  String(query?.policyDetails?.preferredBank || query?.bankName || "").trim();

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

const getDocumentUploadUrl = () =>
  `${String(config.frontendUrl || "").replace(/\/+$/, "")}/application-status`;

const sendLoanEmail = async (query: any, subject: string, message: string) => {
  const contact = getCustomerContact(query);
  if (!contact.email) return;
  await sendMail(
    createDefaultMailOptions(
      contact.email,
      subject,
      `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>Hi ${contact.name},</p>
        <p>${message}</p>
        <p>Application ID: <strong>${query?.loanId || "-"}</strong></p>
        <p>Regards,<br/>Fintaraa</p>
      </div>`,
    ),
  ).catch((error) => console.log("Loan email failed:", error?.message || error));
};

const sendLoanWhatsapp = async (
  query: any,
  templateKey: LoanWhatsappTemplateKey,
  values: unknown[],
) => {
  const contact = getCustomerContact(query);
  if (!contact.mobile || !config.integrations.interakt.enabled)
    return;
  let template;
  try {
    template = getLoanWhatsappTemplate(templateKey, values);
  } catch (error: any) {
    console.log("Loan WhatsApp skipped:", error?.message || error);
    return;
  }
  await sendInteraktTemplateMessage({
    countryCode: config.integrations.interakt.defaultCountryCode,
    phoneNumber: contact.mobile,
    type: "Template",
    callbackData: `loan:${getApplicationId(query)}:${templateKey}`,
    template,
  }).catch((error) =>
    console.log("Loan WhatsApp failed:", error?.message || error),
  );
};

export const notifyLoanApplicationCreated = async (queryOrId: any) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select("customerId loanId loanType email mobile firstName lastName")
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

  const context = getLoanNotificationContext(query);
  await sendLoanEmail(
    query,
    "Loan Application Created",
    `Your ${context.loanType} application has been created successfully.`,
  );
  await sendLoanWhatsapp(query, "applicationCreated", [
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
            "customerId loanId loanType status email mobile firstName lastName bankName loanAmount disbursedAmount policyDetails",
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

  const context = getLoanNotificationContext(query);
  await sendLoanEmail(
    query,
    `Loan Application Update - ${context.stage}`,
    `Your loan application is now at ${context.stage}.`,
  );
  const templateKey = loanWhatsappTemplateForStatus(query.status);
  if (!templateKey) return;

  const contact = getCustomerContact(query);
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
      formatAmount(query?.loanAmount),
      getLenderName(query),
    ],
    loanDisbursed: [
      contact.name,
      formatAmount(query?.disbursedAmount ?? query?.loanAmount),
      getLenderName(query),
    ],
    applicationRejected: [contact.name, getLenderName(query)],
  };
  await sendLoanWhatsapp(query, templateKey, valuesByTemplate[templateKey]);
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
