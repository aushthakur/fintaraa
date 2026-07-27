import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
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

const truthy = (value: unknown, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildAdminListQuery = (query: Record<string, any>) => {
  const filter: Record<string, any> = {};
  const exactFields = [
    "status",
    "bankSlug",
    "productSlug",
    "bankName",
    "productName",
  ];

  exactFields.forEach((field) => {
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
      { bankName: pattern },
      { bankSlug: pattern },
      { productName: pattern },
      { productSlug: pattern },
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
  if (Object.keys(dateRange).length) {
    filter.updatedAt = dateRange;
  }

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
    "bankName",
    "productName",
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
  bankSlug: string,
  productSlug: string,
  location: Record<string, string>,
) => {
  const parts = [
    "/banks",
    bankSlug,
    productSlug,
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
  if (bankSlug.includes("axis")) return "/assets/banks/axis-bank.png";
  if (bankSlug.includes("indus")) return "/assets/banks/indusind.png";
  if (bankSlug.includes("idfc")) return "/assets/banks/idfc.png";
  if (bankSlug.includes("bajaj")) return "/assets/banks/bajaj.png";
  if (bankSlug.includes("shriram")) return "/assets/banks/shriram.png";
  if (bankSlug.includes("baroda")) return "/assets/banks/bank-of-baroda1.png";
  if (bankSlug.includes("canara")) return "/assets/banks/canara-bank.png";
  if (bankSlug.includes("union")) return "/assets/banks/union-bank.png";
  if (bankSlug.includes("bank-of-india"))
    return "/assets/banks/bank-of-india.png";
  if (bankSlug.includes("indian-bank"))
    return "/assets/banks/indian-bank.png";
  if (bankSlug.includes("central-bank"))
    return "/assets/banks/Central-Bank-of-India.png";
  if (bankSlug.includes("federal")) return "/assets/banks/Federal-Bank.png";
  if (bankSlug.includes("bandhan")) return "/assets/banks/Bandhan-Bank.png";
  if (bankSlug.includes("uco")) return "/assets/banks/UCO-Bank.png";
  if (bankSlug.includes("punjab-and-sind"))
    return "/assets/banks/Punjab-&-Sind-Bank.png";
  if (bankSlug.includes("south-indian"))
    return "/assets/banks/south-indian-bank.png";
  if (bankSlug.includes("idbi")) return "/assets/banks/IDBI-Bank.png";
  if (bankSlug.includes("yes-bank")) return "/assets/banks/yes-bank.png";
  if (bankSlug.includes("sbi") || bankSlug.includes("state-bank"))
    return "/assets/banks/sbi-logo.png";
  if (bankSlug.includes("pnb") || bankSlug.includes("punjab-national"))
    return "/assets/banks/pnb.png";
  return "/assets/banks/indian.png";
};

const locationSpecificity = (location: Record<string, string>) =>
  ["state", "city", "pincode", "area"].filter((field) =>
    Boolean(clean(location[field])),
  ).length;

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

      const requestedSpecificity = locationSpecificity(location);
      const best = candidates
        .map((page) => ({
          page,
          score: scorePage(page, location),
          specificity: locationSpecificity(page.location || {}),
        }))
        .filter(
          (item) =>
            item.score >= 0 && item.specificity >= requestedSpecificity,
        )
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

  static async listPublicPages(req: Request, res: Response, next: NextFunction) {
    try {
      const bankSlug = toSlug(req.query.bankSlug || req.query.bankName);
      const productSlug = toSlug(req.query.productSlug || req.query.product);
      const query: Record<string, any> = { status: BankSeoPageStatus.ACTIVE };
      if (bankSlug) query.bankSlug = bankSlug;
      if (productSlug) query.productSlug = productSlug;
      ["country", "state", "city", "pincode", "area"].forEach((field) => {
        const value = clean((req.query as Record<string, any>)[field]);
        if (value) query[`location.${field}`] = value;
      });

      const cursorMode =
        clean(req.query.pagination).toLowerCase() === "cursor";
      const cursor = clean(req.query.cursor);
      if (cursorMode && cursor) {
        if (!Types.ObjectId.isValid(cursor)) {
          throw new ApiError(400, "Invalid pagination cursor");
        }
        query._id = { $gt: new Types.ObjectId(cursor) };
      }

      const limit = Math.min(
        Math.max(Number(req.query.limit || 250), 1),
        500,
      );
      const page = Math.max(Number(req.query.page) || 1, 1);
      const request = BankSeoPage.find(query)
        .sort(cursorMode ? { _id: 1 } : { priority: 1, updatedAt: -1 })
        .limit(limit)
        .select(
          "bankName bankSlug productName productSlug title canonicalPath logoUrl location priority isFeatured updatedAt",
        );

      if (!cursorMode) {
        request.skip((page - 1) * limit).allowDiskUse(true);
      }

      const result = await request.lean();

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bank pages fetched successfully"));
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
      const query = req.query as Record<string, any>;
      const filter = buildAdminListQuery(query);
      const sort = buildAdminListSort(query);
      const usePagination = truthy(query.pagination, true);

      if (!usePagination) {
        const limit = Math.min(Math.max(Number(query.limit || 100), 1), 500);
        const result = await BankSeoPage.find(filter)
          .sort(sort)
          .limit(limit)
          .allowDiskUse(true)
          .lean();
        return res
          .status(200)
          .json(new ApiResponse(200, result, "Bank pages fetched successfully"));
      }

      const page = Math.max(Number(query.page || 1), 1);
      const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
      const skip = (page - 1) * limit;
      const [result, totalItems] = await Promise.all([
        BankSeoPage.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .allowDiskUse(true)
          .lean(),
        BankSeoPage.countDocuments(filter),
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
            "Bank pages fetched successfully",
          ),
        );
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
