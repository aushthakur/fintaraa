import { NextFunction, Request, Response } from "express";
import axios from "axios";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { EligibilityCriteria } from "../../modals/eligibilityCriteria.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { createMailOptions, transporter } from "../../config/nodeMailerConfig";

const EligibilityCriteriaService = new CommonService(EligibilityCriteria);
const criteriaFieldLabels: Record<string, string> = {
  loanType: "Loan Type",
  bankName: "Bank Name",
  salaryType: "Income Type",
  commissionType: "Commission Type",
  commissionValue: "Commission Value",
  commissionMinAmount: "Commission Min Amount",
  commissionMaxAmount: "Commission Max Amount",
  commissionCapAmount: "Commission Cap Amount",
  itrWithFinancial: "ITR With Financial",
  gstProgram: "GST Program",
  cashProfit: "Cash Profit",
  lowTv: "Low LTV",
  bankingSurrogate: "Banking Surrogate",
  companyListed: "Company Listed",
  foir: "FOIR",
  minimumVintage: "Minimum Vintage",
  businessAge: "Business Age",
  currentExperience: "Current Experience",
  totalExperience: "Total Experience",
  salaryAmount: "Salary Amount",
  form16Itr: "Form16/ITR",
  grossSalary: "Gross Salary",
  netSalary: "Net Salary",
  currentTotalEmi: "Current Total EMI",
  netIncome: "Net Income",
  netProfit: "Net Profit",
  cibilScoreWithCall: "CIBIL Score",
  catAApproved: "Cat A Approved",
  catBSemiApproved: "Cat B Semi Approved",
  catCUnapproved: "Cat C Unapproved",
  rateOfInterest: "Rate Of Interest",
  averageBankBalance: "Average Bank Balance",
  rm: "RM",
  rmMailId: "RM Mail ID",
  rmMbNo: "RM Mobile",
  asm: "ASM",
  asmMailId: "ASM Mail ID",
  asmMbNo: "ASM Mobile",
  zsm: "RSM",
  zsmMailId: "RSM Mail ID",
  zsmMbNo: "RSM Mobile",
  remarks: "Remarks",
  status: "Status",
};

const formatValue = (value: any) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const humanize = (value: any) =>
  formatValue(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

const buildCriteriaRows = (criteria: Record<string, any>) =>
  Object.keys(criteriaFieldLabels)
    .map((key) => {
      const label = criteriaFieldLabels[key];
      const value = humanize(criteria[key]);
      return `<tr><td style=\"padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;\">${label}</td><td style=\"padding:6px 10px;border:1px solid #e2e8f0;\">${value}</td></tr>`;
    })
    .join("");

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
      const result = await EligibilityCriteriaService.updateById(
        req.params.id,
        req.body,
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
      } = req.body || {};

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

      const results = await Promise.all(
        criteriaList.map(async (criteria: any) => {
          const recipients = [
            criteria.rmMailId,
            criteria.asmMailId,
            criteria.zsmMailId,
          ]
            .map((mail: string) => String(mail || "").trim())
            .filter(Boolean);

          if (recipients.length === 0) {
            return {
              id: criteria._id,
              sent: false,
              reason: "No recipient emails",
            };
          }

          const subject = `Eligibility Criteria Match - ${criteria.bankName || "Bank"}`;
          const applicantRows = buildApplicantRows(loanQuery);
          const criteriaRows = buildCriteriaRows(criteria);

          const attachmentNote = attachments.length
            ? `<p style="margin:12px 0 0; font-size:12px; color:#475569;">${attachments.length} attachment(s) included with this email.</p>`
            : "";

          const html = `
            <div style="font-family: Arial, sans-serif; color: #0f172a;">
              <h2 style="margin:0 0 12px;">Eligibility Match Details</h2>
              ${
                applicantRows
                  ? `<h3 style="margin:16px 0 8px;">Applicant Summary</h3>
                     <table style="border-collapse:collapse; width:100%; font-size:13px;">${applicantRows}</table>`
                  : ""
              }
              <h3 style="margin:16px 0 8px;">Eligibility Criteria</h3>
              <table style="border-collapse:collapse; width:100%; font-size:13px;">${criteriaRows}</table>
              ${attachmentNote}
            </div>
          `;

          await transporter.sendMail(
            createMailOptions(recipients.join(","), subject, html, attachments),
          );

          return { id: criteria._id, sent: true, recipients };
        }),
      );

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
