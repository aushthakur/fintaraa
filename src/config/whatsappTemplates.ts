import { ApplicationStatus } from "../modals/insurancequery.model";

export type LoanWhatsappTemplateKey =
  | "applicationCreated"
  | "documentsRequired"
  | "bankLoginSuccess"
  | "loanSanctioned"
  | "loanDisbursed"
  | "applicationRejected";

type LoanWhatsappTemplate = {
  name: string;
  languageCode: string;
  valueCount: number;
};

const languageCode = process.env.INTERAKT_LOAN_TEMPLATE_LANGUAGE || "en";

/**
 * Interakt template names and placeholder counts from the approved WhatsApp
 * templates. Environment overrides allow template names to differ between
 * Interakt workspaces without changing application code.
 */
export const LOAN_WHATSAPP_TEMPLATES: Record<
  LoanWhatsappTemplateKey,
  LoanWhatsappTemplate
> = {
  applicationCreated: {
    name:
      process.env.INTERAKT_LOAN_CREATED_TEMPLATE || "loan_application_created",
    languageCode,
    valueCount: 2,
  },
  documentsRequired: {
    name:
      process.env.INTERAKT_LOAN_DOCUMENTS_REQUIRED_TEMPLATE ||
      "documents_required",
    languageCode,
    valueCount: 3,
  },
  bankLoginSuccess: {
    name:
      process.env.INTERAKT_LOAN_LOGIN_TEMPLATE || "bank_login_success",
    languageCode,
    valueCount: 3,
  },
  loanSanctioned: {
    name: process.env.INTERAKT_LOAN_SANCTION_TEMPLATE || "Loan_Sanctioned",
    languageCode,
    valueCount: 3,
  },
  loanDisbursed: {
    name:
      process.env.INTERAKT_LOAN_DISBURSEMENT_TEMPLATE || "Loan_disbursed",
    languageCode,
    valueCount: 3,
  },
  applicationRejected: {
    name:
      process.env.INTERAKT_LOAN_REJECTED_TEMPLATE || "Application_Rejected",
    languageCode,
    valueCount: 2,
  },
};

export const loanWhatsappTemplateForStatus = (
  status: string,
): LoanWhatsappTemplateKey | undefined => {
  switch (status) {
    case ApplicationStatus.DOCUMENTS_REQUESTED:
      return "documentsRequired";
    case ApplicationStatus.LOGIN_DONE:
      return "bankLoginSuccess";
    case ApplicationStatus.SANCTIONED:
      return "loanSanctioned";
    case ApplicationStatus.DISBURSED:
    case ApplicationStatus.DISBURSED_PARTIAL_FULL:
      return "loanDisbursed";
    case ApplicationStatus.REJECTED:
    case ApplicationStatus.REJECTED_BY_BANK:
      return "applicationRejected";
    default:
      return undefined;
  }
};

export const getLoanWhatsappTemplate = (
  key: LoanWhatsappTemplateKey,
  rawValues: unknown[],
) => {
  const template = LOAN_WHATSAPP_TEMPLATES[key];
  const bodyValues = rawValues.map((value) => String(value ?? "").trim());

  if (bodyValues.length !== template.valueCount) {
    throw new Error(
      `WhatsApp template ${template.name} expects ${template.valueCount} body values; received ${bodyValues.length}.`,
    );
  }
  if (bodyValues.some((value) => !value)) {
    throw new Error(`WhatsApp template ${template.name} has an empty body value.`);
  }

  return {
    name: template.name,
    languageCode: template.languageCode,
    bodyValues,
  };
};
