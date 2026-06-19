import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  LoanSeoPage,
  LoanSeoPageStatus,
} from "../../modals/loanSeoPage.model";

const loanSeoPageService = new CommonService(LoanSeoPage);

const toTitle = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const toSlug = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const clean = (value: unknown) => String(value || "").trim();

const lowerKey = (value: unknown) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseArrayInput = (value: any) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const normalizeLocation = (input: Record<string, any>) => ({
  country: clean(input.country) || "India",
  state: clean(input.state),
  city: clean(input.city),
  pincode: clean(input.pincode),
  area: clean(input.area),
});

const buildLocationLabel = (location: Record<string, string>) =>
  [location.area, location.pincode, location.city, location.state]
    .filter(Boolean)
    .join(", ");

const buildCanonicalPath = (
  loanTypeSlug: string,
  location: Record<string, string>,
) => {
  const parts = [
    "/products",
    loanTypeSlug,
    location.state && toSlug(location.state),
    location.city && toSlug(location.city),
    location.pincode && toSlug(location.pincode),
    location.area && toSlug(location.area),
  ].filter(Boolean);
  return parts.join("/");
};

const buildDefaultPage = (
  loanTypeSlug: string,
  location: Record<string, string>,
) => {
  const loanType = toTitle(loanTypeSlug);
  const locationLabel = buildLocationLabel(location);
  const scopedLoan = locationLabel ? `${loanType} in ${locationLabel}` : loanType;
  const title = `${scopedLoan} | Fintaraa`;

  return {
    _id: `default-${loanTypeSlug}`,
    loanType,
    loanTypeSlug,
    title: scopedLoan,
    subtitle:
      "Compare eligibility, documents, fees, repayment comfort, and partner-backed offers in one assisted journey.",
    heroTitle: `${scopedLoan} made easier`,
    heroDescription:
      "Use Fintaraa to review requirements, prepare documents, and apply with guided support from regulated lending partners.",
    seoTitle: title,
    seoDescription: `Apply for ${scopedLoan} with Fintaraa. Check eligibility, documents, EMI comfort, and assisted partner offers.`,
    canonicalPath: buildCanonicalPath(loanTypeSlug, location),
    location,
    badges: ["Partner-backed", "Assisted application", "Secure documents"],
    filterKeys: [
      "overview",
      "eligibility",
      "documents",
      "fees",
      "emi",
      "apply",
    ],
    tabs: [
      {
        key: "overview",
        label: "Overview",
        eyebrow: "Loan guide",
        title: `${scopedLoan} overview`,
        description:
          "Understand how this loan can fit your requirement before sharing documents or completing an application.",
        bullets: [
          "Compare lender-side eligibility signals before applying.",
          "Prepare KYC, income, address, and bank documents in advance.",
          "Track your application from profile completion to fulfilment.",
        ],
        stats: [
          { label: "Journey", value: "Assisted" },
          { label: "Documents", value: "Digital" },
          { label: "Support", value: "Dedicated" },
        ],
        filterKeys: ["overview", "loan_guide"],
        sortOrder: 1,
        isActive: true,
      },
      {
        key: "eligibility",
        label: "Eligibility",
        eyebrow: "Applicant fit",
        title: `${loanType} eligibility checks`,
        description:
          "Eligibility varies by lender, income source, credit profile, loan amount, and serviceable location.",
        bullets: [
          "PAN, Aadhaar, mobile, and basic profile details are required.",
          "Income and employment details help match suitable lenders.",
          "Credit history and existing EMI obligations may affect approval.",
        ],
        filterKeys: ["eligibility", "income", "cibil"],
        sortOrder: 2,
        isActive: true,
      },
      {
        key: "documents",
        label: "Documents",
        eyebrow: "Checklist",
        title: `Documents for ${scopedLoan}`,
        description:
          "The exact checklist can change by applicant type and lender, but core KYC and income proofs are usually needed.",
        bullets: [
          "Identity and address proof.",
          "PAN and recent photograph.",
          "Income proof, bank statement, and business or employment proof where applicable.",
        ],
        filterKeys: ["documents", "kyc", "income_proof"],
        sortOrder: 3,
        isActive: true,
      },
      {
        key: "fees",
        label: "Fees",
        eyebrow: "Cost view",
        title: `${loanType} charges and repayment terms`,
        description:
          "Review interest rate range, processing fee, foreclosure rules, insurance add-ons, and total repayment before moving ahead.",
        bullets: [
          "Compare EMI comfort, tenure, and total interest outgo.",
          "Ask for processing fee and prepayment terms upfront.",
          "Avoid submitting duplicate applications with multiple partners.",
        ],
        filterKeys: ["fees", "emi", "repayment"],
        sortOrder: 4,
        isActive: true,
      },
    ],
    formFields: [
      {
        key: "fullName",
        label: "Full name",
        type: "text",
        placeholder: "Enter your full name",
        required: true,
        tabKey: "apply",
        filterKey: "full_name",
        sortOrder: 1,
        isActive: true,
      },
      {
        key: "mobile",
        label: "Mobile number",
        type: "tel",
        placeholder: "10-digit mobile number",
        required: true,
        tabKey: "apply",
        filterKey: "mobile",
        sortOrder: 2,
        isActive: true,
      },
      {
        key: "loanAmount",
        label: "Loan amount",
        type: "number",
        placeholder: "Required amount",
        required: true,
        tabKey: "apply",
        filterKey: "loan_amount",
        sortOrder: 3,
        isActive: true,
      },
      {
        key: "employmentType",
        label: "Employment type",
        type: "select",
        options: ["Salaried", "Self-employed professional", "Business owner"],
        required: true,
        tabKey: "apply",
        filterKey: "employment_type",
        sortOrder: 4,
        isActive: true,
      },
      {
        key: "pincode",
        label: "Pincode",
        type: "text",
        placeholder: "Service pincode",
        required: true,
        tabKey: "apply",
        filterKey: "pincode",
        sortOrder: 5,
        isActive: true,
      },
    ],
    status: LoanSeoPageStatus.ACTIVE,
    isIndexable: true,
    isFeatured: false,
    priority: 999,
    isFallback: true,
  };
};

const scorePage = (page: any, target: Record<string, string>) => {
  const location = page?.location || {};
  const fields = ["country", "state", "city", "pincode", "area"];
  return fields.reduce((score, field, index) => {
    const expected = lowerKey(target[field]);
    const actual = lowerKey(location[field]);
    if (!actual) return score;
    return actual === expected ? score + index + 1 : -1000;
  }, 0);
};

const pageTime = (page: any) =>
  new Date(page?.updatedAt || page?.publishedAt || page?.createdAt || 0).getTime() ||
  0;

const normalizePayload = (body: Record<string, any>) => ({
  ...body,
  loanTypeSlug: toSlug(body.loanTypeSlug || body.loanType),
  location: normalizeLocation(body.location || body),
  tabs: parseArrayInput(body.tabs),
  formFields: parseArrayInput(body.formFields),
  filterKeys: parseArrayInput(body.filterKeys).map(lowerKey).filter(Boolean),
  badges: parseArrayInput(body.badges),
});

export class LoanSeoPageController {
  static async listPublicPages(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const pages = await LoanSeoPage.find({
        status: LoanSeoPageStatus.ACTIVE,
      })
        .select("loanType loanTypeSlug title subtitle canonicalPath priority updatedAt")
        .sort({ priority: 1, updatedAt: -1 })
        .limit(Math.min(Number(req.query?.limit) || 200, 300))
        .lean();

      return res
        .status(200)
        .json(new ApiResponse(200, pages, "Loan pages fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async resolvePublicPage(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const loanTypeSlug = toSlug(req.params.loanType || req.query.loanType);
      if (!loanTypeSlug) {
        throw new ApiError(400, "Loan type is required");
      }

      const location = normalizeLocation(req.query as Record<string, any>);
      const query = {
        loanTypeSlug,
        status: LoanSeoPageStatus.ACTIVE,
        $or: [
          { "location.country": { $in: [location.country, "", null] } },
          { "location.country": { $exists: false } },
        ],
      };

      const candidates = await LoanSeoPage.find(query).lean();
      const best = candidates
        .map((page) => ({ page, score: scorePage(page, location) }))
        .filter((item) => item.score >= 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            pageTime(b.page) - pageTime(a.page) ||
            (a.page.priority || 999) - (b.page.priority || 999),
        )
        .at(0)?.page;

      const result = best || buildDefaultPage(loanTypeSlug, location);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan page fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createPage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await loanSeoPageService.create(normalizePayload(req.body));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Loan page created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPages(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await loanSeoPageService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan pages fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPageById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await loanSeoPageService.getById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan page fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await loanSeoPageService.updateById(
        req.params.id,
        normalizePayload(req.body),
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan page updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deletePage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await loanSeoPageService.deleteById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan page deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
