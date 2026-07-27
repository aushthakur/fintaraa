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

const truthy = (value: unknown, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildAdminListQuery = (query: Record<string, any>) => {
  const filter: Record<string, any> = {};
  ["status", "loanTypeSlug", "loanType"].forEach((field) => {
    const value = clean(query[field]);
    if (value) filter[field] = value;
  });
  ["country", "state", "city", "pincode", "area"].forEach((field) => {
    const value = clean(query[field]);
    if (value) filter[`location.${field}`] = value;
  });

  const search = clean(query.search);
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { title: pattern },
      { subtitle: pattern },
      { seoTitle: pattern },
      { loanType: pattern },
      { loanTypeSlug: pattern },
      { canonicalPath: pattern },
      { "location.country": pattern },
      { "location.state": pattern },
      { "location.city": pattern },
      { "location.pincode": pattern },
      { "location.area": pattern },
    ];
  }

  const dateRange: Record<string, Date> = {};
  const startDate = clean(query.startDate);
  const endDate = clean(query.endDate);
  if (startDate) {
    const parsed = new Date(startDate);
    if (!Number.isNaN(parsed.getTime())) dateRange.$gte = parsed;
  }
  if (endDate) {
    const parsed = new Date(endDate);
    if (!Number.isNaN(parsed.getTime())) dateRange.$lte = parsed;
  }
  if (Object.keys(dateRange).length) filter.updatedAt = dateRange;

  return filter;
};

const buildAdminListSort = (query: Record<string, any>): Record<string, 1 | -1> => {
  const sortKey = clean(query.sortKey) || "_id";
  const sortDir: 1 | -1 =
    clean(query.sortDir).toLowerCase() === "asc" ? 1 : -1;
  const allowedSorts = new Set([
    "_id",
    "createdAt",
    "updatedAt",
    "priority",
    "title",
    "loanType",
  ]);

  if (!allowedSorts.has(sortKey)) return { _id: -1 };
  return { [sortKey]: sortDir, _id: sortDir };
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
      "features",
      "eligibility",
      "documents",
      "steps_to_apply",
      "emi_calculator",
      "fees_and_charges",
      "reviews",
      "faqs",
    ],
    tabs: [
      {
        key: "overview",
        label: "Overview",
        eyebrow: "Loan guide",
        title: `${scopedLoan} overview`,
        description:
          "Review eligibility, documents, application steps, EMI, fees, reviews, and FAQs before applying.",
        bullets: [
          "Check applicant fit, document list, EMI comfort, and common charges.",
          "Understand the assisted steps before you start the application.",
          "Prepare KYC, income, address, and bank documents in advance.",
        ],
        stats: [
          { label: "Journey", value: "Assisted" },
          { label: "Documents", value: "Digital" },
          { label: "Support", value: "Dedicated" },
        ],
        filterKeys: ["overview", "complete_guide", "loan_guide"],
        sortOrder: 0,
        isActive: true,
      },
      {
        key: "features",
        label: "Features",
        eyebrow: "Highlights",
        title: `${loanType} features`,
        description:
          "Key features depend on lender policy, applicant profile, amount, and repayment tenure.",
        bullets: [
          "Digital discovery with guided application support.",
          "Flexible amount and tenure options from eligible partners.",
          "Partner-specific collateral or asset checks where applicable.",
          "Clear next steps for documentation and verification.",
        ],
        filterKeys: ["features", "benefits"],
        sortOrder: 2,
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
        sortOrder: 3,
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
        sortOrder: 4,
        isActive: true,
      },
      {
        key: "steps_to_apply",
        label: "Steps to Apply",
        eyebrow: "Application process",
        title: `Steps to apply for ${scopedLoan}`,
        description:
          "Follow the guided Fintaraa journey to share details, verify your mobile number, review matched partner options, and submit documents.",
        bullets: [
          "Start with mobile number, PAN, income, and location details.",
          "Verify OTP and complete the secure assisted application flow.",
          "Review matched partner options before document submission.",
          "Upload requested documents and track follow-up with Fintaraa support.",
        ],
        filterKeys: ["steps_to_apply", "apply", "process", "verification"],
        sortOrder: 5,
        isActive: true,
      },
      {
        key: "emi_calculator",
        label: "EMI Calculator",
        eyebrow: "Repayment view",
        title: `${loanType} EMI planning`,
        description:
          "Estimate EMI comfort before applying by reviewing amount, tenure, and expected interest range.",
        bullets: [
          "Compare monthly EMI against income and existing obligations.",
          "Shorter tenures can reduce total interest but increase EMI.",
          "Longer tenures can reduce monthly EMI but increase total repayment.",
        ],
        filterKeys: ["emi_calculator", "emi", "repayment"],
        sortOrder: 6,
        isActive: true,
      },
      {
        key: "fees_and_charges",
        label: "Fees & Charges",
        eyebrow: "Cost view",
        title: `${loanType} fees and charges`,
        description:
          "Review interest rate range, processing fee, foreclosure rules, insurance add-ons, and total repayment before moving ahead.",
        bullets: [
          "Compare EMI comfort, tenure, and total interest outgo.",
          "Ask for processing fee and prepayment terms upfront.",
          "Avoid submitting duplicate applications with multiple partners.",
        ],
        filterKeys: ["fees", "emi", "repayment"],
        sortOrder: 7,
        isActive: true,
      },
      {
        key: "reviews",
        label: "Reviews",
        eyebrow: "Customer view",
        title: `${loanType} customer reviews`,
        description:
          "Customer experience varies by lender and document readiness, but guided support helps keep the journey organised.",
        bullets: [
          "Applicants value clear document checklists before lender review.",
          "Guided callbacks help reduce back-and-forth during verification.",
          "EMI and fee visibility helps users compare options carefully.",
        ],
        filterKeys: ["reviews", "testimonials"],
        sortOrder: 8,
        isActive: true,
      },
      {
        key: "faqs",
        label: "FAQs",
        eyebrow: "Common questions",
        title: `FAQs about ${scopedLoan}`,
        description: `Find answers to common questions about ${loanType}.`,
        bullets: [
          "Quick answers to common application questions.",
          "Learn about eligibility, documents, and repayment.",
          "Get clarity before applying.",
        ],
        faqs: [
          {
            question: `What is the minimum income required for ${loanType}?`,
            answer:
              "Income requirements vary by lender, amount, profile, and location. A stable income or business cash flow usually improves approval chances.",
          },
          {
            question: `How long does ${loanType} approval take?`,
            answer:
              "Timelines depend on lender checks and document verification. Complete details and clean documents can reduce back-and-forth.",
          },
          {
            question: `Can I apply for ${loanType} with a low credit score?`,
            answer:
              "A stronger score helps, but some partners may also evaluate income stability, banking behaviour, and existing obligations.",
          },
        ],
        filterKeys: ["faqs", "questions"],
        sortOrder: 9,
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

const locationSpecificity = (location: Record<string, string> = {}) =>
  ["state", "city", "pincode", "area"].filter((field) =>
    Boolean(clean(location[field])),
  ).length;

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
      const loanTypeSlug = toSlug(req.query.loanTypeSlug || req.query.loanType);
      const location = normalizeLocation(req.query as Record<string, any>);
      const query: Record<string, any> = {
        status: LoanSeoPageStatus.ACTIVE,
      };
      if (loanTypeSlug) query.loanTypeSlug = loanTypeSlug;
      if (String(req.query.catalogOnly || "").toLowerCase() === "true") {
        query.$and = ["state", "city", "pincode", "area"].map((field) => ({
          $or: [
            { [`location.${field}`]: "" },
            { [`location.${field}`]: null },
            { [`location.${field}`]: { $exists: false } },
          ],
        }));
      }
      (["country", "state", "city", "pincode", "area"] as const).forEach(
        (field) => {
          if (clean(location[field])) query[`location.${field}`] = location[field];
        },
      );

      const limit = Math.min(
        Math.max(Number(req.query?.limit) || 200, 1),
        1000,
      );
      const page = Math.max(Number(req.query?.page) || 1, 1);
      const pages = await LoanSeoPage.find({
        ...query,
      })
        .select(
          "loanType loanTypeSlug title subtitle canonicalPath location priority updatedAt",
        )
        .sort({ priority: 1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
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
      const targetSpecificity = locationSpecificity(location);
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

      const bestSpecificity = locationSpecificity(best?.location || {});
      const result =
        best && (!targetSpecificity || bestSpecificity >= targetSpecificity)
          ? best
          : buildDefaultPage(loanTypeSlug, location);
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
      const query = req.query as Record<string, any>;
      const filter = buildAdminListQuery(query);
      const sort = buildAdminListSort(query);
      const usePagination = truthy(query.pagination, true);

      if (!usePagination) {
        const limit = Math.min(Math.max(Number(query.limit || 100), 1), 500);
        const result = await LoanSeoPage.find(filter)
          .sort(sort)
          .limit(limit)
          .allowDiskUse(true)
          .lean();
        return res
          .status(200)
          .json(new ApiResponse(200, result, "Loan pages fetched successfully"));
      }

      const page = Math.max(Number(query.page || 1), 1);
      const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
      const skip = (page - 1) * limit;
      const [result, totalItems] = await Promise.all([
        LoanSeoPage.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .allowDiskUse(true)
          .lean(),
        LoanSeoPage.countDocuments(filter),
      ]);

      const formattedResult = {
        result,
        pagination: {
          totalItems,
          currentPage: page,
          itemsPerPage: limit,
          totalPages: Math.ceil(totalItems / limit),
        },
      };

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            formattedResult,
            "Loan pages fetched successfully",
          ),
        );
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
