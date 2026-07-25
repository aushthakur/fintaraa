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

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const emailShell = ({
  preheader,
  body,
  cta,
}: {
  preheader: string;
  body: string;
  cta?: { label: string; href: string };
}) => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Fintaraa</title>
  </head>
  <body style="margin:0;background:#f4f7fb;padding:0;font-family:Arial,Helvetica,sans-serif;color:#172033">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb">
      <tr>
        <td align="center" style="padding:28px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;overflow:hidden;border:1px solid #dfe8f2;border-radius:18px;background:#ffffff">
            <tr>
              <td style="background:#071b35;padding:22px 30px">
                <div style="font-size:24px;font-weight:800;letter-spacing:-0.4px;color:#ffffff">Fintaraa</div>
                <div style="margin-top:4px;font-size:12px;letter-spacing:1.2px;color:#70d6ff">SMARTER FINANCIAL JOURNEYS</div>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 30px 26px;font-size:16px;line-height:1.65;color:#344054">
                ${body}
                ${
                  cta
                    ? `<div style="padding-top:14px">
                         <a href="${escapeHtml(cta.href)}" style="display:inline-block;border-radius:10px;background:#0969da;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(cta.label)}</a>
                       </div>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e8eef5;padding:20px 30px;font-size:13px;line-height:1.6;color:#667085">
                Team Fintaraa<br />
                <span style="color:#98a2b3">This is a service update for your loan application.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const paragraph = (value: string) =>
  `<p style="margin:0 0 16px">${value}</p>`;

const detail = (label: string, value: string) =>
  `<div style="margin:8px 0;border-radius:10px;background:#f5f8fc;padding:12px 14px"><span style="font-size:13px;color:#667085">${escapeHtml(label)}</span><br /><strong style="font-size:16px;color:#172033">${escapeHtml(value)}</strong></div>`;

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
  const name = escapeHtml(context.name || "Customer");
  const bankName = context.bankName || "our lending partner";

  switch (key) {
    case "applicationCreated": {
      const preheader = `Hi ${context.name}, your application ${context.applicationId} is now with our team.`;
      return {
        templateName: "loan_application_created",
        subject: "Your loan application has been created – Fintaraa",
        preheader,
        html: emailShell({
          preheader,
          body: [
            paragraph(`Hi ${name},`),
            paragraph("Your loan application has been created successfully."),
            detail("Application ID", context.applicationId),
            paragraph(
              "Our team is reviewing your documents and will update you soon.",
            ),
            paragraph("Thank you for choosing Fintaraa."),
          ].join(""),
          cta: {
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
        subject: "Action needed: Documents required for your loan application",
        preheader,
        html: emailShell({
          preheader,
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              "To process your loan application, we require the following documents:",
            ),
            detail("Documents required", context.documentName),
            paragraph("Please click the button below to upload your documents."),
            paragraph(
              "Please share them at the earliest to avoid any delay.",
            ),
          ].join(""),
          cta: {
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
        subject: `Good news! Your loan application has been logged in with ${bankName}`,
        preheader,
        html: emailShell({
          preheader,
          body: [
            paragraph(`Hi ${name},`),
            paragraph("<strong style=\"color:#172033\">Good news!</strong>"),
            paragraph(
              `Your loan application has been successfully logged in with ${escapeHtml(bankName)}.`,
            ),
            detail("Application ID", context.applicationId),
            paragraph("We'll update you on every stage."),
          ].join(""),
          cta: {
            label: "View Application",
            href: context.trackApplicationLink,
          },
        }),
      };
    }
    case "loanSanctioned": {
      const preheader = `Your loan of ₹${context.loanAmount} has been sanctioned by ${bankName}.`;
      return {
        templateName: "loan_sanctioned",
        subject: `Congratulations ${context.name}! Your loan has been sanctioned`,
        preheader,
        html: emailShell({
          preheader,
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              "<strong style=\"color:#087443\">Congratulations!</strong>",
            ),
            paragraph("Your loan has been sanctioned."),
            detail("Loan Amount", `₹${context.loanAmount}`),
            detail("Bank", bankName),
            paragraph(
              "Our representative will contact you regarding the disbursement process.",
            ),
          ].join(""),
          cta: {
            label: "View Sanction Details",
            href: context.trackApplicationLink,
          },
        }),
      };
    }
    case "loanDisbursed": {
      const preheader = `₹${context.disburseAmount} has been disbursed by ${bankName}.`;
      return {
        templateName: "loan_disbursed",
        subject: `Congratulations ${context.name}! Your loan amount has been disbursed`,
        preheader,
        html: emailShell({
          preheader,
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              "<strong style=\"color:#087443\">Congratulations!</strong>",
            ),
            paragraph("Your loan has been successfully disbursed."),
            detail("Loan Amount", `₹${context.disburseAmount}`),
            detail("Bank", bankName),
            paragraph("Thank you for choosing Fintaraa."),
            paragraph("Congratulations once again!"),
          ].join(""),
        }),
      };
    }
    case "applicationRejected": {
      const preheader = `Hi ${context.name}, an update regarding your application with ${bankName}.`;
      return {
        templateName: "application_rejected",
        subject: "Update on your loan application – Fintaraa",
        preheader,
        html: emailShell({
          preheader,
          body: [
            paragraph(`Hi ${name},`),
            paragraph(
              `We regret to inform you that your loan application could not be approved by ${escapeHtml(bankName)}.`,
            ),
            paragraph(
              "Our Loan Advisor will help you explore alternative options.",
            ),
          ].join(""),
          cta: {
            label: "Talk to a Loan Advisor",
            href: context.contactAdvisorLink,
          },
        }),
      };
    }
  }
};
