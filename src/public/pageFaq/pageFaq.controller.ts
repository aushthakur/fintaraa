import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { IPageFaq, PageFaq, PageFaqItem } from "../../modals/pageFaq.model";

const parseJsonValue = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const normalizePathname = (value: unknown) => {
  const raw = String(value || "/").trim();
  let path = raw;
  try {
    path = raw.startsWith("http") ? new URL(raw).pathname : raw.split("?")[0].split("#")[0];
  } catch {
    path = raw.split("?")[0].split("#")[0];
  }
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
};

const makeSlug = (pathname: string) =>
  `page-faq-${pathname === "/" ? "home" : pathname.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;

const makeStoragePathname = (pathname: string) => `faq:${pathname}`;

const normalizeAliases = (value: unknown) => {
  const aliases = parseJsonValue<string[]>(value, Array.isArray(value) ? value : []);
  return Array.from(
    new Set(
      (Array.isArray(aliases) ? aliases : [])
        .map((item) => normalizePathname(item))
        .filter(Boolean),
    ),
  );
};

const normalizeItems = (value: unknown): PageFaqItem[] => {
  const items = parseJsonValue<PageFaqItem[]>(value, Array.isArray(value) ? value : []);
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim(),
      isActive: item?.isActive !== false,
      priorityOrder: Number(item?.priorityOrder ?? index + 1),
    }))
    .filter((item) => item.question && item.answer);
};

const normalizePayload = (payload: Record<string, any>) => {
  const pathname = normalizePathname(payload.pathname);
  const items = normalizeItems(payload.items || payload.faqs);
  const schemaJson = parseJsonValue<Record<string, any> | undefined>(
    payload.schemaJson,
    payload.schemaJson && typeof payload.schemaJson === "object"
      ? payload.schemaJson
      : undefined,
  );

  return {
    recordType: "page_faq",
    slug: payload.slug || makeSlug(pathname),
    pathname: makeStoragePathname(pathname),
    pagePathname: pathname,
    pathAliases: normalizeAliases(payload.pathAliases || payload.aliases),
    title: String(payload.title || "Frequently Asked Questions").trim(),
    subtitle: String(payload.subtitle || "Answers to common questions about this page.").trim(),
    items,
    schemaEnabled: payload.schemaEnabled !== false && payload.schemaEnabled !== "false",
    schemaJson,
    status: ["draft", "active", "archived"].includes(payload.status)
      ? payload.status
      : "active",
    priorityOrder: Number(payload.priorityOrder || 0),
  };
};

const dynamicCandidates = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  const candidates = [pathname];
  if (segments[0] === "blog" && segments[1]) candidates.push("/blog/[slug]");
  if (segments[0] === "products" && segments[1]) {
    candidates.push("/products/[loanType]");
    candidates.push("/products/[insuranceType]");
    candidates.push("/products/[product]");
  }
  if (segments[0] === "banks" && segments[1] && segments[2]) {
    candidates.push("/banks/[bankName]/[product]");
  }
  if (segments[0] === "apply" && segments[1] && segments[2]) {
    candidates.push("/apply/[category]/[product]");
  }
  return Array.from(new Set(candidates));
};

const activeItems = (pageFaq: IPageFaq | any) =>
  (pageFaq.items || [])
    .filter((item: PageFaqItem) => item.isActive !== false)
    .sort(
      (a: PageFaqItem, b: PageFaqItem) =>
        Number(a.priorityOrder || 0) - Number(b.priorityOrder || 0),
    );

const buildSchemaJson = (pageFaq: IPageFaq | any) => {
  if (!pageFaq.schemaEnabled) return undefined;
  if (pageFaq.schemaJson && Object.keys(pageFaq.schemaJson).length) {
    return pageFaq.schemaJson;
  }
  const items = activeItems(pageFaq);
  if (!items.length) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item: PageFaqItem) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
};

const serialize = (pageFaq: IPageFaq | any) => {
  const items = activeItems(pageFaq);
  return {
    ...pageFaq,
    pathname: pageFaq.pagePathname,
    items,
    schemaJson: buildSchemaJson({ ...pageFaq, items }),
  };
};

export class PageFaqController {
  static async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const pathname = normalizePathname(req.query.pathname);
      const candidates = dynamicCandidates(pathname);
      const pageFaq = await PageFaq.findOne({
        recordType: "page_faq",
        status: "active",
        $or: [
          { pagePathname: { $in: candidates } },
          { pathAliases: { $in: candidates } },
        ],
      })
        .sort({ priorityOrder: 1, updatedAt: -1 })
        .lean();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            pageFaq ? serialize(pageFaq) : null,
            pageFaq ? "Page FAQs fetched" : "Page FAQs not found",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query: Record<string, any> = { recordType: "page_faq" };
      if (req.query.status) query.status = req.query.status;
      if (req.query.pathname) query.pagePathname = normalizePathname(req.query.pathname);
      const items = await PageFaq.find(query)
        .sort({ priorityOrder: 1, updatedAt: -1 })
        .limit(Math.min(Number(req.query.limit) || 100, 300))
        .lean();
      return res
        .status(200)
        .json(new ApiResponse(200, items.map(serialize), "Page FAQs fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await PageFaq.findOne({
        _id: req.params.id,
        recordType: "page_faq",
      }).lean();
      if (!item) return res.status(404).json(new ApiError(404, "Page FAQ not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, serialize(item), "Page FAQ fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = normalizePayload(req.body || {});
      if (!payload.items.length) {
        return res.status(400).json(new ApiError(400, "At least one FAQ is required"));
      }
      const item = await PageFaq.findOneAndUpdate(
        { recordType: "page_faq", pagePathname: payload.pagePathname },
        payload,
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
      return res
        .status(201)
        .json(new ApiResponse(201, serialize(item), "Page FAQ saved"));
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = normalizePayload(req.body || {});
      if (!payload.items.length) {
        return res.status(400).json(new ApiError(400, "At least one FAQ is required"));
      }
      const item = await PageFaq.findOneAndUpdate(
        { _id: req.params.id, recordType: "page_faq" },
        payload,
        { new: true, runValidators: true },
      );
      if (!item) return res.status(404).json(new ApiError(404, "Page FAQ not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, serialize(item), "Page FAQ updated"));
    } catch (err) {
      next(err);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await PageFaq.findOneAndDelete({
        _id: req.params.id,
        recordType: "page_faq",
      });
      if (!item) return res.status(404).json(new ApiError(404, "Page FAQ not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, serialize(item), "Page FAQ deleted"));
    } catch (err) {
      next(err);
    }
  }
}
