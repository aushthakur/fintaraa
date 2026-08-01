import {
  escapeEmailHtml,
  renderLightTransactionalEmail,
} from "../utils/transactionalEmailTemplate";

export type LoanEmailTemplateKey =
  | "applicationCreated"
  | "documentsRequired"
  | "bankLoginSuccess"
  | "loanSanctioned"
  | "loanDisbursed"
  | "applicationRejected";

export type LoanEmailTemplateContext = {
  name: string;
  applicationId: string;
  loanType: string;
  bankName: string;
  loanAmount: string;
  disburseAmount: string;
  documentName: string;
  trackApplicationLink: string;
  websiteUrl: string;
  contactAdvisorLink: string;
};

export type RenderedLoanEmail = {
  templateName: string;
  subject: string;
  preheader: string;
  html: string;
};

const paragraph = (value: string) =>
  `<p style="margin:0 0 16px">${value}</p>`;

const applicationSummary = (
  rows: Array<{ label: string; value: string }>,
) => {
  const content = rows
    .filter((row) => row.value && row.value !== "—")
    .map(
      (row, index) => `
        <tr>
          <td style="${index ? "border-top:1px solid #e4edf3;" : ""}padding:11px 0;font-size:12px;line-height:1.5;color:#667085">${escapeEmailHtml(row.label)}</td>
          <td align="right" style="${index ? "border-top:1px solid #e4edf3;" : ""}padding:11px 0 11px 16px;font-size:13px;font-weight:700;line-height:1.5;word-break:break-word;color:#102a43">${escapeEmailHtml(row.value)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="margin:22px 0;border:1px solid #d8e6ef;border-radius:12px;background-color:#f8fbfd;padding:16px 18px">
      <div style="margin-bottom:4px;font-size:11px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;color:#0b72b9">Application summary</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${content}</table>
    </div>`;
};

const nextSteps = (items: string[]) => `
  <div style="margin:22px 0 16px">
    <h2 style="margin:0 0 12px;font-size:17px;line-height:1.4;color:#102a43">What happens next</h2>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      ${items
        .map(
          (item, index) => `
            <tr>
              <td valign="top" width="30" style="padding:5px 10px 5px 0">
                <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background-color:#e8f4fb;text-align:center;font-size:11px;font-weight:800;line-height:22px;color:#0b72b9">${index + 1}</span>
              </td>
              <td valign="top" style="padding:5px 0;font-size:14px;line-height:1.6;color:#475467">${escapeEmailHtml(item)}</td>
            </tr>`,
        )
        .join("")}
    </table>
  </div>`;

const informationNote = (value: string) =>
  `<div style="margin:18px 0;border-left:4px solid #5aa9d6;border-radius:0 8px 8px 0;background-color:#f1f8fc;padding:12px 14px;font-size:12px;line-height:1.65;color:#475467">${escapeEmailHtml(value)}</div>`;

export const renderLoanEmail = (
  key: LoanEmailTemplateKey,
  rawContext: LoanEmailTemplateContext,
): RenderedLoanEmail => {
  const context = Object.fromEntries(
    Object.entries(rawContext).map(([name, value]) => [
      name,
      String(value || "").trim(),
    ]),
  ) as LoanEmailTemplateContext;
  const name = escapeEmailHtml(context.name || "Customer");
  const bankName = context.bankName || "our lending partner";
  const loanType = context.loanType || "Loan";
  const requestedAmount =
    context.loanAmount && context.loanAmount !== "—"
      ? `₹${context.loanAmount}`
      : "—";
  const disbursedAmount =
    context.disburseAmount && context.disburseAmount !== "—"
      ? `₹${context.disburseAmount}`
      : "—";

  switch (key) {
    case "applicationCreated": {
      const preheader = `Hi ${context.name}, your application ${context.applicationId} is now with our team.`;
      return {
        templateName: "loan_application_created",
        subject: `Application ${context.applicationId} received – Fintaraa`,
        preheader,
        html: renderLightTransactionalEmail({
          preheader,
          eyebrow: "Loan application update",
          title: "Application received",
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              `Thank you for applying for a <strong style="color:#102a43">${escapeEmailHtml(loanType)}</strong> through Fintaraa. We have received your application and it is now in our review queue.`,
            ),
            applicationSummary([
              { label: "Application Number", value: context.applicationId },
              { label: "Loan product", value: loanType },
              { label: "Requested amount", value: requestedAmount },
              { label: "Current status", value: "Application received" },
            ]),
            nextSteps([
              "Our team will review the details and documents submitted with your application.",
              "If any clarification or additional document is required, we will contact you on your registered details.",
              "You will receive further updates as your application moves through lender assessment.",
            ]),
            informationNote(
              "Please keep your Application Number handy whenever you contact Fintaraa about this request.",
            ),
          ].join(""),
          action: {
            label: "Track Application Status",
            href: context.trackApplicationLink,
          },
        }),
      };
    }
    case "documentsRequired": {
      const preheader = `Hi ${context.name}, please upload ${context.documentName} to continue.`;
      return {
        templateName: "documents_required",
        subject: `Action required for application ${context.applicationId}`,
        preheader,
        html: renderLightTransactionalEmail({
          preheader,
          eyebrow: "Action required",
          title: "Documents required",
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              "We need an additional document to continue processing your loan application.",
            ),
            applicationSummary([
              { label: "Application Number", value: context.applicationId },
              { label: "Loan product", value: loanType },
              { label: "Document required", value: context.documentName },
              { label: "Current status", value: "Documents required" },
            ]),
            nextSteps([
              "Upload a clear and complete PDF or image of the requested document.",
              "Ensure the name and details match the information provided in your application.",
              "Our team will review the uploaded document and resume processing your application.",
            ]),
            informationNote(
              "Uploading the requested document promptly helps avoid unnecessary processing delays.",
            ),
          ].join(""),
          action: {
            label: "Upload Documents",
            href: context.websiteUrl,
          },
        }),
      };
    }
    case "bankLoginSuccess": {
      const preheader = `Hi ${context.name}, your application ${context.applicationId} has moved forward.`;
      return {
        templateName: "bank_login_success",
        subject: `Application ${context.applicationId} logged with ${bankName}`,
        preheader,
        html: renderLightTransactionalEmail({
          preheader,
          eyebrow: "Loan application update",
          title: "Application logged with the lender",
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              `Good news—your <strong style="color:#102a43">${escapeEmailHtml(loanType)}</strong> application has been logged with ${escapeEmailHtml(bankName)} for assessment.`,
            ),
            applicationSummary([
              { label: "Application Number", value: context.applicationId },
              { label: "Loan product", value: loanType },
              { label: "Lender", value: bankName },
              { label: "Current status", value: "Logged with lender" },
            ]),
            nextSteps([
              "The lender will assess your eligibility, submitted information, and supporting documents.",
              "The lender or Fintaraa may contact you if further verification is required.",
              "We will notify you when there is a decision or another action is needed.",
            ]),
            informationNote(
              "Logging an application with a lender is not a guarantee of approval. The final decision remains subject to the lender's assessment and policy.",
            ),
          ].join(""),
          action: {
            label: "View Application",
            href: context.trackApplicationLink,
          },
        }),
      };
    }
    case "loanSanctioned": {
      const preheader = `Your loan application ${context.applicationId} has been sanctioned by ${bankName}.`;
      return {
        templateName: "loan_sanctioned",
        subject: `Loan application ${context.applicationId} sanctioned`,
        preheader,
        html: renderLightTransactionalEmail({
          preheader,
          eyebrow: "Loan application update",
          title: "Your loan has been sanctioned",
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              "<strong style=\"color:#087443\">Congratulations!</strong>",
            ),
            paragraph(
              `Your <strong style="color:#102a43">${escapeEmailHtml(loanType)}</strong> application has been sanctioned by ${escapeEmailHtml(bankName)}.`,
            ),
            applicationSummary([
              { label: "Application Number", value: context.applicationId },
              { label: "Loan product", value: loanType },
              { label: "Sanctioned amount", value: requestedAmount },
              { label: "Lender", value: bankName },
              { label: "Current status", value: "Sanctioned" },
            ]),
            nextSteps([
              "Review the lender's sanction letter, including interest rate, tenure, EMI, fees, and conditions.",
              "Complete any pending agreement, verification, or disbursement formalities requested by the lender.",
              "Our representative will guide you through the remaining disbursement process.",
            ]),
            informationNote(
              "The sanction remains subject to the terms, validity period, and conditions stated in the lender's official sanction letter.",
            ),
          ].join(""),
          action: {
            label: "View Sanction Details",
            href: context.trackApplicationLink,
          },
        }),
      };
    }
    case "loanDisbursed": {
      const preheader = `Your loan application ${context.applicationId} has been disbursed by ${bankName}.`;
      return {
        templateName: "loan_disbursed",
        subject: `Loan application ${context.applicationId} disbursed`,
        preheader,
        html: renderLightTransactionalEmail({
          preheader,
          eyebrow: "Loan application update",
          title: "Your loan has been disbursed",
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              "<strong style=\"color:#087443\">Congratulations!</strong>",
            ),
            paragraph(
              `The disbursement for your <strong style="color:#102a43">${escapeEmailHtml(loanType)}</strong> application has been completed by ${escapeEmailHtml(bankName)}.`,
            ),
            applicationSummary([
              { label: "Application Number", value: context.applicationId },
              { label: "Loan product", value: loanType },
              { label: "Disbursed amount", value: disbursedAmount },
              { label: "Lender", value: bankName },
              { label: "Current status", value: "Disbursed" },
            ]),
            nextSteps([
              "Confirm that the amount has been credited to the expected account or beneficiary.",
              "Keep the loan agreement, repayment schedule, and lender communication safely for future reference.",
              "Review your EMI start date and maintain sufficient balance before each repayment date.",
            ]),
            informationNote(
              "If the credited amount or beneficiary details do not match your lender documents, contact us immediately.",
            ),
          ].join(""),
          action: {
            label: "View Application Details",
            href: context.trackApplicationLink,
          },
        }),
      };
    }
    case "applicationRejected": {
      const preheader = `Hi ${context.name}, an update regarding your application with ${bankName}.`;
      return {
        templateName: "application_rejected",
        subject: `Update on loan application ${context.applicationId}`,
        preheader,
        html: renderLightTransactionalEmail({
          preheader,
          eyebrow: "Loan application update",
          title: "Update on your application",
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              `We are sorry to inform you that your <strong style="color:#102a43">${escapeEmailHtml(loanType)}</strong> application could not be approved by ${escapeEmailHtml(bankName)} at this stage.`,
            ),
            applicationSummary([
              { label: "Application Number", value: context.applicationId },
              { label: "Loan product", value: loanType },
              { label: "Lender", value: bankName },
              { label: "Current status", value: "Not approved" },
            ]),
            nextSteps([
              "A Fintaraa Loan Advisor can review whether another lender or product may suit your profile.",
              "You may be asked for updated information before exploring an alternative application.",
              "Avoid submitting repeated applications in a short period unless advised, as multiple credit enquiries may affect your credit profile.",
            ]),
            informationNote(
              "Approval decisions are made independently by lenders according to their internal credit policies. Alternative options are subject to eligibility and are not guaranteed.",
            ),
          ].join(""),
          action: {
            label: "Talk to a Loan Advisor",
            href: context.contactAdvisorLink,
          },
        }),
      };
    }
  }
};
