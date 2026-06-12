import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BankSeoPage, BankSeoPageStatus } from "../../modals/bankSeoPage.model";

const bankSeoPageService = new CommonService(BankSeoPage);

const clean = (value: unknown) => String(value || "").trim();

const toTitle = (value: unknown) =>
  clean(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const toSlug = (value: unknown) =>
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
  bankSlug: string,
  productSlug: string,
  location: Record<string, string>,
) => {
  const parts = [
    "/banks",
    bankSlug,
    productSlug,
    location.country && toSlug(location.country),
    location.state && toSlug(location.state),
    location.city && toSlug(location.city),
    location.pincode && toSlug(location.pincode),
    location.area && toSlug(location.area),
  ].filter(Boolean);
  return parts.join("/");
};

const logoForBank = (bankSlug: string) => {
  if (bankSlug.includes("hdfc")) return "/assets/banks/hdfc.png";
  if (bankSlug.includes("icici")) return "/assets/banks/icici.png";
  if (bankSlug.includes("kotak")) return "/assets/banks/kotak.png";
  if (bankSlug.includes("sbi")) return "/assets/banks/sbi.png";
  if (bankSlug.includes("pnb")) return "/assets/banks/pnb.png";
  return "/assets/banks/indian.png";
};

const buildDefaultPage = (
  bankSlug: string,
  productSlug: string,
  location: Record<string, string>,
) => {
  const bankName = toTitle(bankSlug);
  const productName = toTitle(productSlug);
  const locationLabel = buildLocationLabel(location);
  const scopedTitle = locationLabel
    ? `${bankName} ${productName} in ${locationLabel}`
    : `${bankName} ${productName}`;

  return {
    _id: `default-${bankSlug}-${productSlug}`,
    bankName,
    bankSlug,
    productName,
    productSlug,
    title: scopedTitle,
    subtitle: `Instant ${productName}s from ${bankName} with assisted application support.`,
    logoUrl: logoForBank(bankSlug),
    heroImageUrl: "",
    trustBadge: "Trusted Partner",
    seoTitle: `${scopedTitle} | Fintaraa`,
    seoDescription: `Apply for ${scopedTitle} with Fintaraa. Review interest rates, eligibility, documents, products, and location-wise support.`,
    canonicalPath: buildCanonicalPath(bankSlug, productSlug, location),
    aboutTitle: `About ${bankName}`,
    aboutDescription: `${bankName} is a trusted financial partner known for customer centric banking solutions and quick loan assistance. With strong branch presence and digital support, ${bankName} offers a wide range of financial products to meet your needs.`,
    location,
    heroStats: [
      { label: "Quick Approval", value: "in 24 hrs" },
      { label: "Attractive Interest Rates", value: "Starts from 10.50% p.a." },
      { label: "Loan Amount", value: "₹50,000 - ₹40 Lakh" },
      { label: "Paperless Process", value: "100% Online" },
    ],
    bankStats: [
      { label: "Founded", value: "1995" },
      { label: "Branches", value: "6,500+" },
      { label: "Presence", value: "1,500+ Cities" },
    ],
    whyApply: [
      "Free & Easy Application",
      "100% Safe & Secure",
      "Multiple Loan Offers",
      "Best Interest Rates",
    ],
    products: [
      {
        title: "Personal Loan",
        description: "Loan up to ₹40 Lakh Interest from 10.50% p.a.",
        href: `/banks/${bankSlug}/personal-loan`,
      },
      {
        title: "Home Loan",
        description: "Loan up to ₹10 Cr Interest from 8.40% p.a.",
        href: `/banks/${bankSlug}/home-loan`,
      },
      {
        title: "Business Loan",
        description: "Loan up to ₹1 Cr Interest from 11.25% p.a.",
        href: `/banks/${bankSlug}/business-loan`,
      },
      {
        title: "Credit Card",
        description: "Lifetime Free Cards Exclusive Rewards",
        href: `/banks/${bankSlug}/credit-card`,
      },
    ],
    tabs: [
      { key: "overview", label: "Overview", sortOrder: 1, isActive: true },
      {
        key: "interest_rate",
        label: "Interest Rate",
        sortOrder: 2,
        isActive: true,
      },
      {
        key: "eligibility",
        label: "Eligibility",
        sortOrder: 3,
        isActive: true,
      },
      { key: "document", label: "Document", sortOrder: 4, isActive: true },
      { key: "product", label: "Product", sortOrder: 5, isActive: true },
      {
        key: "why_bank",
        label: `Why ${bankName.split(" ")[0]}`,
        sortOrder: 6,
        isActive: true,
      },
      { key: "review", label: "Review", sortOrder: 7, isActive: true },
    ],
    interestRates: Array.from({ length: 4 }, (_, index) => ({
      loanAmount: "Up to ₹5 Lakh",
      interestRate: "10.50% onwards",
      processingFee: "Up to 2.50%",
      tenure: "12 - 60 Months",
      sortOrder: index + 1,
    })),
    applyBullets: ["Minimal Documentation", "Quick Disbursal"],
    status: BankSeoPageStatus.ACTIVE,
    priority: 999,
    isFeatured: false,
    isIndexable: true,
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

const normalizePayload = (body: Record<string, any>) => ({
  ...body,
  bankSlug: toSlug(body.bankSlug || body.bankName),
  productSlug: toSlug(body.productSlug || body.productName),
  location: normalizeLocation(body.location || body),
  heroStats: parseArrayInput(body.heroStats),
  bankStats: parseArrayInput(body.bankStats),
  whyApply: parseArrayInput(body.whyApply),
  products: parseArrayInput(body.products),
  tabs: parseArrayInput(body.tabs),
  interestRates: parseArrayInput(body.interestRates),
  applyBullets: parseArrayInput(body.applyBullets),
});

export class BankSeoPageController {
  static async resolvePublicPage(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const bankSlug = toSlug(req.params.bankName || req.query.bankName);
      const productSlug = toSlug(req.params.product || req.query.product);
      if (!bankSlug || !productSlug) {
        throw new ApiError(400, "Bank name and product are required");
      }

      const location = normalizeLocation(req.query as Record<string, any>);
      const candidates = await BankSeoPage.find({
        bankSlug,
        productSlug,
        status: BankSeoPageStatus.ACTIVE,
        $or: [
          { "location.country": { $in: [location.country, "", null] } },
          { "location.country": { $exists: false } },
        ],
      }).lean();

      const best = candidates
        .map((page) => ({ page, score: scorePage(page, location) }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score || a.page.priority - b.page.priority)
        .at(0)?.page;

      const result = best || buildDefaultPage(bankSlug, productSlug, location);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bank page fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createPage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await bankSeoPageService.create(
        normalizePayload(req.body),
      );
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Bank page created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPages(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await bankSeoPageService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bank pages fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPageById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await bankSeoPageService.getById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bank page fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await bankSeoPageService.updateById(
        req.params.id,
        normalizePayload(req.body),
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bank page updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deletePage(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await bankSeoPageService.deleteById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bank page deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
