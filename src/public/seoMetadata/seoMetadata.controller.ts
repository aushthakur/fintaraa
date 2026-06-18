import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { SeoMetadata } from "../../modals/seoMetadata.model";

const SEO_SECTION_KEY = "seo_metadata";

const normalizePathname = (value: unknown) => {
  const raw = String(value || "/").trim().split("?")[0] || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
};

const normalizePayload = (payload: Record<string, any>) => {
  const next = { ...payload };
  if (next.pathname) next.pathname = normalizePathname(next.pathname);
  if (!next.canonicalPath && next.pathname) next.canonicalPath = next.pathname;
  if (next.canonicalPath) next.canonicalPath = normalizePathname(next.canonicalPath);
  if (next.pathname) {
    next.slug = `seo-${next.pathname
      .replace(/^\/$/, "home")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()}`;
  }
  next.sectionKey = SEO_SECTION_KEY;
  next.type = "article";
  if (typeof next.keywords === "string") {
    next.keywords = next.keywords
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
  }
  if (typeof next.isActive === "string") next.isActive = next.isActive === "true";
  if (typeof next.robotsIndex === "string") next.robotsIndex = next.robotsIndex === "true";
  if (typeof next.robotsFollow === "string") next.robotsFollow = next.robotsFollow === "true";
  return next;
};

export class SeoMetadataController {
  static async resolveByPathname(req: Request, res: Response, next: NextFunction) {
    try {
      const pathname = normalizePathname(req.query.pathname);
      const item = await SeoMetadata.findOne({
        pathname,
        sectionKey: SEO_SECTION_KEY,
        isActive: true,
      }).lean();
      if (!item) return res.status(404).json(new ApiError(404, "SEO metadata not found"));
      return res.status(200).json(new ApiResponse(200, item, "SEO metadata fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 20, 1);
      const filter: Record<string, any> = { sectionKey: SEO_SECTION_KEY };
      ["pathname", "title", "description"].forEach((key) => {
        if (req.query[key]) {
          filter[key] = { $regex: String(req.query[key]), $options: "i" };
        }
      });
      if (req.query.isActive !== undefined) {
        filter.isActive = String(req.query.isActive) === "true";
      }
      const [items, totalItems] = await Promise.all([
        SeoMetadata.find(filter)
          .sort({ updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        SeoMetadata.countDocuments(filter),
      ]);
      const result = {
        result: items,
        pagination: {
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
          currentPage: page,
          itemsPerPage: limit,
        },
      };
      return res.status(200).json(new ApiResponse(200, result, "SEO metadata fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await SeoMetadata.findOne({
        _id: req.params.id,
        sectionKey: SEO_SECTION_KEY,
      }).lean();
      if (!result) return res.status(404).json(new ApiError(404, "SEO metadata not found"));
      return res.status(200).json(new ApiResponse(200, result, "SEO metadata fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = normalizePayload(req.body || {});
      if (!payload.pathname || !payload.title || !payload.description) {
        return res
          .status(400)
          .json(new ApiError(400, "Pathname, title, and description are required"));
      }
      const existing = await SeoMetadata.findOne({
        pathname: payload.pathname,
        sectionKey: SEO_SECTION_KEY,
      }).lean();
      if (existing) {
        return res
          .status(409)
          .json(new ApiError(409, "SEO metadata already exists for this pathname"));
      }
      const result = await SeoMetadata.create(payload);
      return res.status(201).json(new ApiResponse(201, result, "SEO metadata created"));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await SeoMetadata.findOneAndUpdate(
        { _id: req.params.id, sectionKey: SEO_SECTION_KEY },
        normalizePayload(req.body || {}),
        { new: true, runValidators: true },
      );
      if (!result) return res.status(404).json(new ApiError(404, "SEO metadata not found"));
      return res.status(200).json(new ApiResponse(200, result, "SEO metadata updated"));
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await SeoMetadata.findOneAndDelete({
        _id: req.params.id,
        sectionKey: SEO_SECTION_KEY,
      });
      if (!result) return res.status(404).json(new ApiError(404, "SEO metadata not found"));
      return res.status(200).json(new ApiResponse(200, result, "SEO metadata deleted"));
    } catch (error) {
      next(error);
    }
  }
}
