import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  InsuranceSeoPage,
  InsuranceSeoPageStatus,
} from "../../modals/insuranceSeoPage.model";

const insuranceSeoPageService = new CommonService(InsuranceSeoPage);

const clean = (value: unknown) => String(value || "").trim();
const slugify = (value: unknown) =>
  clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const lowerKey = (value: unknown) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const titleize = (value: unknown) =>
  clean(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const parseArrayInput = (value: any) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
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

const locationLabel = (location: Record<string, string>) =>
  [location.area, location.pincode, location.city, location.state]
    .filter(Boolean)
    .join(", ");

const canonicalPath = (
  insuranceTypeSlug: string,
  location: Record<string, string>,
) =>
  [
    "/products",
    insuranceTypeSlug,
    location.state && slugify(location.state),
    location.city && slugify(location.city),
    location.pincode && slugify(location.pincode),
    location.area && slugify(location.area),
  ]
    .filter(Boolean)
    .join("/");

const buildDefaultPage = (
  insuranceTypeSlug: string,
  location: Record<string, string>,
) => {
  const insuranceType = titleize(insuranceTypeSlug);
  const scoped = locationLabel(location)
    ? `${insuranceType} in ${locationLabel(location)}`
    : insuranceType;

  return {
    _id: `default-${insuranceTypeSlug}`,
    insuranceType,
    insuranceTypeSlug,
    title: scoped,
    subtitle:
      "Compare premiums, coverage, exclusions, documents, and claim support through Fintaraa.",
    heroTitle: `${insuranceType} Compare Plans`,
    heroDescription:
      "Get clear plan information, understand coverage, and continue to a guided insurance enquiry journey.",
    seoTitle: `${scoped} | Fintaraa`,
    seoDescription: `Compare ${scoped} plans with Fintaraa. Review premiums, coverage, documents, claim process, and partner options.`,
    canonicalPath: canonicalPath(insuranceTypeSlug, location),
    location,
    badges: ["Claim support", "Partner plans", "Secure enquiry"],
    filterKeys: ["coverage", "premium", "claims", "documents", "eligibility"],
    tabs: [
      {
        key: "coverage",
        label: "Coverage",
        title: `Understanding your ${insuranceType} coverage`,
        description:
          "Review what is commonly covered and what may be excluded before choosing a plan.",
        covered: [
          "Hospitalisation or covered loss as per policy wording.",
          "Pre and post event expenses where applicable.",
          "Cashless or reimbursement support with network partners.",
          "Emergency assistance and claim guidance.",
        ],
        notCovered: [
          "Waiting period exclusions.",
          "Non-disclosed pre-existing conditions.",
          "Cosmetic or non-covered procedures.",
          "Claims outside policy terms and limits.",
        ],
        filterKeys: ["coverage", "covered", "not_covered"],
        sortOrder: 1,
        isActive: true,
      },
      {
        key: "eligibility",
        label: "Eligibility",
        title: `${insuranceType} eligibility criteria`,
        description:
          "Eligibility varies by age, location, health declarations, sum insured, product type, and insurer underwriting.",
        bullets: [
          "Applicant age and identity details.",
          "Current city, state, pincode, and area.",
          "Health, asset, trip, or business declarations as applicable.",
          "Previous policy and claim history where required.",
        ],
        filterKeys: ["eligibility", "age", "sum_insured"],
        sortOrder: 2,
        isActive: true,
      },
      {
        key: "documents",
        label: "Documents",
        title: `Required documents for ${insuranceType}`,
        description:
          "The exact checklist depends on insurance category and partner policy.",
        bullets: [
          "KYC details and registered mobile number.",
          "Address and pincode details.",
          "Previous policy copy if renewing.",
          "Asset, health, travel, or business documents when applicable.",
        ],
        filterKeys: ["documents", "kyc", "policy_copy"],
        sortOrder: 3,
        isActive: true,
      },
    ],
    formFields: [
      {
        key: "age",
        label: "Age of insured member",
        type: "number",
        placeholder: "Age",
        required: true,
        filterKey: "age",
        sortOrder: 1,
        isActive: true,
      },
      {
        key: "city",
        label: "City",
        type: "text",
        placeholder: "City",
        required: true,
        filterKey: "city",
        sortOrder: 2,
        isActive: true,
      },
      {
        key: "sumInsured",
        label: "Sum insured",
        type: "select",
        options: ["3L", "5L", "10L", "25L", "50L"],
        required: true,
        filterKey: "sum_insured",
        sortOrder: 3,
        isActive: true,
      },
      {
        key: "mobile",
        label: "Mobile number",
        type: "tel",
        placeholder: "10-digit mobile",
        required: true,
        filterKey: "mobile",
        sortOrder: 4,
        isActive: true,
      },
    ],
    status: InsuranceSeoPageStatus.ACTIVE,
    isIndexable: true,
    isFeatured: false,
    priority: 999,
    isFallback: true,
  };
};

const scorePage = (page: any, target: Record<string, string>) => {
  const location = page?.location || {};
  return ["country", "state", "city", "pincode", "area"].reduce(
    (score, field, index) => {
      const actual = lowerKey(location[field]);
      if (!actual) return score;
      return actual === lowerKey(target[field]) ? score + index + 1 : -1000;
    },
    0,
  );
};

const normalizePayload = (body: Record<string, any>) => ({
  ...body,
  insuranceTypeSlug: slugify(body.insuranceTypeSlug || body.insuranceType),
  location: normalizeLocation(body.location || body),
  tabs: parseArrayInput(body.tabs),
  formFields: parseArrayInput(body.formFields),
  filterKeys: parseArrayInput(body.filterKeys).map(lowerKey).filter(Boolean),
  badges: parseArrayInput(body.badges),
});

export class InsuranceSeoPageController {
  static async listPublicPages(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const pages = await InsuranceSeoPage.find({
        status: InsuranceSeoPageStatus.ACTIVE,
      })
        .select(
          "insuranceType insuranceTypeSlug title subtitle canonicalPath priority updatedAt",
        )
        .sort({ priority: 1, updatedAt: -1 })
        .limit(Math.min(Number(req.query?.limit) || 200, 300))
        .lean();

      return res
        .status(200)
        .json(
          new ApiResponse(200, pages, "Insurance pages fetched successfully"),
        );
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
      const insuranceTypeSlug = slugify(
        req.params.insuranceType || req.query.insuranceType,
      );
      if (!insuranceTypeSlug) throw new ApiError(400, "Insurance type is required");

      const location = normalizeLocation(req.query as Record<string, any>);
      const candidates = await InsuranceSeoPage.find({
        insuranceTypeSlug,
        status: InsuranceSeoPageStatus.ACTIVE,
      }).lean();
      const best = candidates
        .map((page) => ({ page, score: scorePage(page, location) }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score || a.page.priority - b.page.priority)
        .at(0)?.page;

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            best || buildDefaultPage(insuranceTypeSlug, location),
            "Insurance page fetched successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async createPage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await insuranceSeoPageService.create(normalizePayload(req.body));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Insurance page created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPages(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await insuranceSeoPageService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Insurance pages fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPageById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await insuranceSeoPageService.getById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Insurance page fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await insuranceSeoPageService.updateById(
        req.params.id,
        normalizePayload(req.body),
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Insurance page updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deletePage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await insuranceSeoPageService.deleteById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Insurance page deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
