import { NextFunction, Request, Response } from "express";
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
  salaryType: "Salary Type",
  itrWithFinancial: "ITR With Financial",
  gstProgram: "GST Program",
  selfEmp: "Self Emp",
  salaryEmp: "Salary Emp",
  cashProfit: "Cash Profit",
  lowTv: "Low TV",
  bankAmount: "Bank Amount",
  bankingSurrogate: "Banking Surrogate",
  companyListed: "Company Listed",
  foir: "FOIR",
  minimumVintage: "Minimum Vintage",
  businessAge: "Business Age",
  grossIncome: "Gross Income",
  currentExperience: "Current Experience",
  totalExperience: "Total Experience",
  salaryAmount: "Salary Amount",
  currentTotalEmi: "Current Total EMI",
  netIncome: "Net Income",
  cibilScoreWithCall: "CIBIL Score With Call",
  catAApproved: "Cat A Approved",
  catBSemiApproved: "Cat B Semi Approved",
  catCUnapproved: "Cat C Unapproved",
  propertyType: "Property Type",
  empAge: "Employee Age",
  loanTenure: "Loan Tenure",
  rateOfInterest: "Rate Of Interest",
  emiAmount: "EMI Amount",
  loginFees: "Login Fees",
  processingFees: "Processing Fees",
  legalValuation: "Legal Valuation",
  insurance: "Insurance",
  rm: "RM",
  rmMailId: "RM Mail ID",
  rmMbNo: "RM Mobile",
  asm: "ASM",
  asmMailId: "ASM Mail ID",
  asmMbNo: "ASM Mobile",
  zsm: "ZSM",
  zsmMailId: "ZSM Mail ID",
  zsmMbNo: "ZSM Mobile",
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
        `<tr><td style=\"padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;\">${label}</td><td style=\"padding:6px 10px;border:1px solid #e2e8f0;\">${formatValue(value)}</td></tr>`
    )
    .join("");
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
        false
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
        req.body
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
      const { criteriaIds = [], queryId } = req.body || {};

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
            "firstName lastName email mobile loanType loanAmount employmentType monthlyIncome customerId cibilScore"
          )
          .populate("customerId", "cibilScore")
          .lean();

        if (loanQuery?.customerId?.cibilScore) {
          loanQuery.customerCibilScore = loanQuery.customerId.cibilScore;
        }
      }

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
            </div>
          `;

          await transporter.sendMail(
            createMailOptions(recipients.join(","), subject, html)
          );

          return { id: criteria._id, sent: true, recipients };
        })
      );

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            total: criteriaList.length,
            sent: results.filter((r) => r.sent).length,
            failed: results.filter((r) => !r.sent).length,
            results,
          },
          "Email dispatch completed"
        )
      );
    } catch (err) {
      next(err);
    }
  }
}
