import { NextFunction, Request, Response } from "express";
import axios from "axios";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { EligibilityCriteria } from "../../modals/eligibilityCriteria.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { createMailOptions, transporter } from "../../config/nodeMailerConfig";
import { checkEligibilityMailAccess } from "../eligibilityMailPermission/eligibilityMailPermission.utils";

const EligibilityCriteriaService = new CommonService(EligibilityCriteria);
const formatValue = (value: any) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const humanize = (value: any) =>
  formatValue(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

const buildApplicantRows = (loan: Record<string, any> | null) => {
  if (!loan) return "";
  const applicant = {
    Name: `${loan.firstName || ""} ${loan.lastName || ""}`.trim() || "-",
    Mobile: loan.mobile || "-",
    Email: loan.email || "-",
    "Loan Type": humanize(loan.loanType || "-"),
    "Loan Amount": loan.loanAmount ?? "-",
    "Employment Type": humanize(loan.employmentType || "-"),
    "Monthly Income": loan.monthlyIncome ?? "-",
    "CIBIL Score": loan.cibilScore ?? loan.customerCibilScore ?? "-",
  };

  return Object.entries(applicant)
    .map(
      ([label, value]) =>
        `<tr><td style=\"padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;\">${label}</td><td style=\"padding:6px 10px;border:1px solid #e2e8f0;\">${formatValue(value)}</td></tr>`,
    )
    .join("");
};

const normalizeEmail = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getRecipientEmails = (
  criteriaList: Record<string, any>[],
  recipientType?: string,
) => {
  const emails = criteriaList.flatMap((criteria) => {
    if (recipientType === "rm") {
      return [criteria.rmMailId];
    }

    return [criteria.rmMailId, criteria.asmMailId, criteria.zsmMailId];
  });

  return Array.from(
    new Set(emails.map(normalizeEmail).filter((email) => Boolean(email))),
  );
};

const buildEligibilityMailHtml = (
  loanQuery: Record<string, any> | null,
  criteriaList: Record<string, any>[],
  recipientType?: string,
) => {
  const applicantRows = buildApplicantRows(loanQuery);
  const criteriaRows = criteriaList
    .map((criteria) => {
      const bankName = formatValue(criteria.bankName);
      const rmName = formatValue(criteria.rm);
      const rmMailId = formatValue(criteria.rmMailId);
      const salaryType = formatValue(criteria.salaryType);
      const score = formatValue(criteria.cibilScoreWithCall);
      return `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;">${bankName}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${rmName}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${rmMailId}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${salaryType}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${score}</td>
        </tr>
      `;
    })
    .join("");

  const recipientLabel = recipientType === "rm" ? "RM" : "Bank Team";

  return `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2 style="margin:0 0 12px;">Eligibility Bank Matches</h2>
      <p style="margin:0 0 12px; font-size:13px; color:#475569;">
        The attached PDF contains the full loan query packet for ${recipientLabel} review.
      </p>
      ${
        applicantRows
          ? `<h3 style="margin:16px 0 8px;">Applicant Summary</h3>
             <table style="border-collapse:collapse; width:100%; font-size:13px;">${applicantRows}</table>`
          : ""
      }
      <h3 style="margin:16px 0 8px;">Matched Criteria</h3>
      <table style="border-collapse:collapse; width:100%; font-size:13px;">
        <tr>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Bank</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">RM</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">RM Email</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Salary Type</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">CIBIL Score</th>
        </tr>
        ${criteriaRows}
      </table>
    </div>
  `;
};

const queueEligibilityMailDispatch = async ({
  recipients,
  subject,
  html,
  attachments,
}: {
  recipients: string[];
  subject: string;
  html: string;
  attachments: any[];
}) => {
  console.log("[EligibilityMail] Queue dispatch started", {
    recipients: recipients.length,
    attachments: attachments.length,
    subject,
  });

  const results = await Promise.allSettled(
    recipients.map(async (email) => {
      console.log("[EligibilityMail] Sending queued mail", { email });
      const info = await transporter.sendMail(
        createMailOptions(email, subject, html, attachments),
      );
      console.log("[EligibilityMail] Queued mail sent", {
        email,
        messageId: info?.messageId,
        accepted: info?.accepted,
        rejected: info?.rejected,
      });
      return info;
    }),
  );

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    console.log("Eligibility mail dispatch completed with failures:", {
      total: recipients.length,
      failed: failures.length,
    });
  }
};

type DocumentAttachmentInput = {
  label?: string;
  url?: string;
  source?: string;
};

const sanitizeFilename = (value: string) => {
  const cleaned = value
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "document";
};

const getExtensionFromContentType = (contentType?: string) => {
  if (!contentType) return null;
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return null;
};

const getExtensionFromUrl = (url: string) => {
  const pathname = url.split("?")[0];
  const ext = pathname.split(".").pop();
  if (!ext || ext.length > 5) return null;
  return ext.toLowerCase();
};

const fetchDocumentAttachment = async (
  doc: DocumentAttachmentInput,
  index: number,
) => {
  if (!doc?.url) return null;
  const response = await axios.get(doc.url, { responseType: "arraybuffer" });
  const contentType = String(
    response.headers["content-type"] || "",
  ).toLowerCase();
  const extension =
    getExtensionFromContentType(contentType) ||
    getExtensionFromUrl(doc.url) ||
    "bin";
  const label = sanitizeFilename(doc.label || `document_${index + 1}`);
  const source = sanitizeFilename(doc.source || "attachment");
  const filename = `${label}_${source}.${extension}`;

  return {
    filename,
    content: Buffer.from(response.data),
    contentType: contentType || "application/octet-stream",
  };
};

export class EligibilityCriteriaController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body || {};
      const result = await EligibilityCriteriaService.create(payload);
      if (!result) {
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create eligibility criteria"));
      }
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityCriteriaService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityCriteriaService.getById(
        req.params.id,
        false,
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Eligibility criteria not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body || {};
      const result = await EligibilityCriteriaService.updateById(
        req.params.id,
        payload,
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update eligibility criteria"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityCriteriaService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete eligibility criteria"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async sendMail(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        criteriaIds = [],
        queryId,
        pdfBase64,
        pdfFileName,
        documentAttachments = [],
        recipientType,
      } = req.body || {};

      console.log("[EligibilityMail] Request received", {
        criteriaIds: Array.isArray(criteriaIds) ? criteriaIds.length : 0,
        queryId,
        recipientType: recipientType || "default",
        pdfAttached: Boolean(pdfBase64),
        documentAttachments: Array.isArray(documentAttachments)
          ? documentAttachments.length
          : 0,
      });

      if (!Array.isArray(criteriaIds) || criteriaIds.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "criteriaIds are required"));
      }

      const criteriaList = await EligibilityCriteria.find({
        _id: { $in: criteriaIds },
      }).lean();

      if (!criteriaList || criteriaList.length === 0) {
        return res
          .status(404)
          .json(new ApiError(404, "No eligibility criteria found"));
      }

      console.log("[EligibilityMail] Criteria resolved", {
        criteriaCount: criteriaList.length,
        queryId,
      });

      let loanQuery: any = null;
      if (queryId) {
        loanQuery = await LoanQuery.findById(queryId)
          .select(
            "firstName lastName email mobile loanType loanAmount employmentType monthlyIncome customerId cibilScore",
          )
          .populate("customerId", "cibilScore")
          .lean();

        if (loanQuery?.customerId?.cibilScore) {
          loanQuery.customerCibilScore = loanQuery.customerId.cibilScore;
        }
      }

      if (recipientType === "rm") {
        if (!queryId) {
          return res
            .status(400)
            .json(new ApiError(400, "queryId is required for RM dispatch"));
        }

        const access = await checkEligibilityMailAccess({
          userId: (req as any)?.user?._id,
          userRole: (req as any)?.user?.role,
          queryType: "loan",
          loanType: loanQuery?.loanType,
        });

        if (!access.allowed) {
          return res
            .status(403)
            .json(
              new ApiError(
                403,
                access.reason || "You do not have access to send this eligibility email",
              ),
            );
        }
      }

      const normalizedDocuments: DocumentAttachmentInput[] = Array.isArray(
        documentAttachments,
      )
        ? documentAttachments
        : [];
      const uniqueDocuments = Array.from(
        new Map(
          normalizedDocuments
            .filter((doc) => doc?.url)
            .map((doc) => [String(doc.url), doc]),
        ).values(),
      );

      const documentAttachmentResults = await Promise.all(
        uniqueDocuments.map(async (doc, index) => {
          try {
            return await fetchDocumentAttachment(doc, index);
          } catch (error) {
            return { error: true, doc };
          }
        }),
      );

      const documentAttachmentFiles = documentAttachmentResults.filter(
        (item: any) => item && !item.error,
      );
      const documentAttachmentFailures = documentAttachmentResults.filter(
        (item: any) => item && item.error,
      );

      const attachments: any[] = [];
      if (typeof pdfBase64 === "string" && pdfBase64.trim()) {
        const normalizedPdf = pdfBase64.replace(
          /^data:application\/pdf;base64,/,
          "",
        );
        attachments.push({
          filename: pdfFileName || `eligibility-${queryId || "details"}.pdf`,
          content: Buffer.from(normalizedPdf, "base64"),
          contentType: "application/pdf",
        });
      }
      attachments.push(...documentAttachmentFiles);

      console.log("[EligibilityMail] Attachments prepared", {
        pdfAttached: Boolean(pdfBase64),
        attachmentCount: attachments.length,
        documentFailures: documentAttachmentFailures.length,
      });

      const subject = `Eligibility Criteria Match - ${
        loanQuery?.firstName || loanQuery?.lastName || loanQuery?.mobile || "Loan Query"
      }`;
      const html = buildEligibilityMailHtml(
        loanQuery,
        criteriaList,
        recipientType,
      );
      const recipients = getRecipientEmails(criteriaList, recipientType);

      console.log("[EligibilityMail] Recipients resolved", {
        recipientType: recipientType || "default",
        recipients,
      });

      if (recipients.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No recipient emails found"));
      }

      if (recipientType === "rm") {
        console.log("[EligibilityMail] Queueing RM dispatch", {
          recipients: recipients.length,
          criteriaCount: criteriaList.length,
        });
        void queueEligibilityMailDispatch({
          recipients,
          subject,
          html,
          attachments,
        }).catch((error: any) => {
          console.log("Eligibility mail queue failed:", error);
        });

        return res.status(202).json(
          new ApiResponse(
            202,
            {
              total: criteriaList.length,
              queued: recipients.length,
              recipientType,
              attachments: {
                total: attachments.length,
                pdfAttached: Boolean(pdfBase64),
                documentFailures: documentAttachmentFailures.length,
              },
            },
            "Email dispatch queued",
          ),
        );
      }

      const results = await Promise.all(
        criteriaList.map(async (criteria: any) => {
          const criteriaRecipients = getRecipientEmails([criteria]);

          if (criteriaRecipients.length === 0) {
            console.log("[EligibilityMail] Skipping criteria with no recipients", {
              criteriaId: criteria._id,
              bankName: criteria.bankName,
            });
            return {
              id: criteria._id,
              sent: false,
              reason: "No recipient emails",
            };
          }

          const criteriaHtml = buildEligibilityMailHtml(
            loanQuery,
            [criteria],
            recipientType,
          );

          console.log("[EligibilityMail] Sending criteria mail", {
            criteriaId: criteria._id,
            bankName: criteria.bankName,
            recipients: criteriaRecipients,
          });

          await transporter.sendMail(
            createMailOptions(
              criteriaRecipients.join(","),
              subject,
              criteriaHtml,
              attachments,
            ),
          );

          console.log("[EligibilityMail] Criteria mail sent", {
            criteriaId: criteria._id,
            recipients: criteriaRecipients,
          });

          return { id: criteria._id, sent: true, recipients: criteriaRecipients };
        }),
      );

      console.log("[EligibilityMail] Dispatch completed", {
        total: criteriaList.length,
        sent: results.filter((r) => r.sent).length,
        failed: results.filter((r) => !r.sent).length,
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            total: criteriaList.length,
            sent: results.filter((r) => r.sent).length,
            failed: results.filter((r) => !r.sent).length,
            results,
            attachments: {
              total: attachments.length,
              pdfAttached: Boolean(pdfBase64),
              documentFailures: documentAttachmentFailures.length,
            },
          },
          "Email dispatch completed",
        ),
      );
    } catch (err) {
      next(err);
    }
  }
}
