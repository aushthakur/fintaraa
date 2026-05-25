import { LoanQuery } from "../modals/loanquery.model";
import { UserType } from "../modals/notification.model";
import { ApplicationStatus } from "../modals/insurancequery.model";
import { sendSingleNotification } from "./notification.service";
import { createDefaultMailOptions, sendMail } from "../utils/emailService";
import { sendInteraktTemplateMessage } from "./interakt.service";
import { config } from "../config/config";

const stageLabels: Record<string, string> = {
  [ApplicationStatus.LOGIN_DONE]: "Login",
  [ApplicationStatus.LOGIN_APPROVED]: "Login Approved",
  [ApplicationStatus.SANCTIONED]: "Sanction",
  [ApplicationStatus.DISBURSED]: "Disbursement",
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

const templateNameForStage = (status: string) => {
  if (status === ApplicationStatus.LOGIN_DONE)
    return process.env.INTERAKT_LOAN_LOGIN_TEMPLATE;
  if (status === ApplicationStatus.SANCTIONED)
    return process.env.INTERAKT_LOAN_SANCTION_TEMPLATE;
  if (
    status === ApplicationStatus.DISBURSED ||
    status === ApplicationStatus.DISBURSED_PARTIAL_FULL
  )
    return process.env.INTERAKT_LOAN_DISBURSEMENT_TEMPLATE;
  return "";
};

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
  templateName: string | undefined,
  values: string[],
) => {
  const contact = getCustomerContact(query);
  if (!templateName || !contact.mobile || !config.integrations.interakt.enabled)
    return;
  await sendInteraktTemplateMessage({
    countryCode: config.integrations.interakt.defaultCountryCode,
    phoneNumber: contact.mobile,
    type: "Template",
    template: {
      name: templateName,
      languageCode: process.env.INTERAKT_LOAN_TEMPLATE_LANGUAGE || "en",
      bodyValues: values,
    },
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
  await sendLoanWhatsapp(query, process.env.INTERAKT_LOAN_CREATED_TEMPLATE, [
    context.loanId,
    context.loanType,
  ]);
};

export const notifyLoanStageUpdated = async (queryOrId: any) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select("customerId loanId loanType status email mobile firstName lastName")
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
  await sendLoanWhatsapp(query, templateNameForStage(query.status), [
    context.loanId,
    context.stage,
  ]);
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
