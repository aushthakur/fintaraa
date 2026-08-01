import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { Knowledge } from "../../modals/knowledge.model";
import { CommonService } from "../../services/common.services";

const normalizeType = (value?: string) => {
  if (!value) return undefined;
  return value.toString().toLowerCase().trim();
};

const publishedContentFilter = () => ({
  $or: [
    { publishedAt: { $exists: false } },
    { publishedAt: null },
    { publishedAt: { $lte: new Date() } },
  ],
});

const knowledgeService = new CommonService(Knowledge);
const knowledgeOnlyStages = [
  {
    $match: {
      sectionKey: { $ne: "seo_metadata" },
      recordType: { $ne: "page_faq" },
    },
  },
];

const getTestimonialValidationError = (payload: Record<string, any>) => {
  if (payload.type !== "testimonial") return "";
  if (!String(payload.authorName || "").trim()) {
    return "Customer name is required for a testimonial";
  }
  if (!String(payload.summary || "").trim()) {
    return "Testimonial content is required";
  }

  const rating = Number(payload.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return "Testimonial rating must be between 1 and 5";
  }
  return "";
};

const buildPublicQuery = (query: Record<string, any>) => {
  const normalizedType = normalizeType(query.type);
  return {
    ...query,
    ...(normalizedType ? { type: normalizedType } : {}),
    ...(query.sectionKey ? { sectionKey: query.sectionKey } : {}),
    isActive: true,
    ...publishedContentFilter(),
  };
};

const isYoutubeUrl = (value: unknown) => {
  const url = String(value || "").trim();
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return [
      "youtube.com",
      "m.youtube.com",
      "youtu.be",
      "youtube-nocookie.com",
    ].includes(hostname);
  } catch {
    return false;
  }
};

const getVideoValidationError = (payload: Record<string, any>) => {
  if (payload.type !== "video") return "";
  const videoUrl = String(payload.videoUrl || "").trim();
  const youtubeUrl = String(payload.youtubeUrl || "").trim();
  if (!videoUrl && !youtubeUrl) {
    return "Upload a video or provide a YouTube link";
  }
  if (youtubeUrl && !isYoutubeUrl(youtubeUrl)) {
    return "Please enter a valid YouTube link";
  }
  return "";
};

export class KnowledgeController {
  static normalizePayload(payload: Record<string, any>) {
    const next: Record<string, any> = { ...payload };
    if (typeof next.isActive === "string") {
      const lowered = next.isActive.toLowerCase();
      if (lowered === "active") next.isActive = true;
      else if (lowered === "inactive") next.isActive = false;
      else if (lowered === "true") next.isActive = true;
      else if (lowered === "false") next.isActive = false;
    }
    if (typeof next.type === "string") {
      next.type = next.type.toLowerCase().trim();
    }
    if (typeof next.tags === "string") {
      next.tags = next.tags
        .split(",")
        .map((tag: string) => tag.trim())
        .filter(Boolean);
    }
    if (typeof next.metaTagKeywords === "string") {
      next.metaTagKeywords = next.metaTagKeywords
        .split(",")
        .map((tag: string) => tag.trim())
        .filter(Boolean);
    }
    if (typeof next.leadSource === "string") {
      next.leadSource = next.leadSource.trim();
    }
    if (typeof next.youtubeUrl === "string") {
      next.youtubeUrl = next.youtubeUrl.trim();
    }
    if (next.type === "video") {
      next.sectionKey =
        String(next.sectionKey || "").trim() || "video_testimonials";
    }
    if (next.type === "blog") {
      next.sectionKey = String(next.sectionKey || "").trim() || "recent_blogs";
    }
    if (next.type === "press_release") {
      next.sectionKey =
        String(next.sectionKey || "").trim() || "media_press_release";
    }
    if (next.type === "award") {
      next.sectionKey =
        String(next.sectionKey || "").trim() || "awards_recognitions";
    }
    if (next.type === "testimonial") {
      next.sectionKey =
        String(next.sectionKey || "").trim() || "client_testimonials";
      if (next.rating !== undefined && next.rating !== null) {
        next.rating = Number(next.rating);
      }
      if (typeof next.authorName === "string") {
        next.authorName = next.authorName.trim();
      }
      if (typeof next.summary === "string") {
        next.summary = next.summary.trim();
      }
    }
    return next;
  }
  static async getAllPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildPublicQuery(req.query as Record<string, any>);
      const items = await knowledgeService.getAll(query, undefined, {
        prependStages: knowledgeOnlyStages,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, items, "Knowledge content fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getAllAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        ...req.query,
        ...(req.query.type
          ? { type: normalizeType(req.query.type as string) }
          : {}),
      };
      const items = await knowledgeService.getAll(query, undefined, {
        prependStages: knowledgeOnlyStages,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, items, "Knowledge content fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const item = await Knowledge.findById(id).lean();
      if (!item) return res.status(404).json(new ApiError(404, "Not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, item, "Knowledge content fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;
      const item = await Knowledge.findOne({
        slug,
        isActive: true,
        ...publishedContentFilter(),
      }).lean();
      if (!item) return res.status(404).json(new ApiError(404, "Not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, item, "Knowledge content fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = KnowledgeController.normalizePayload(req.body || {});
      const actor = (req as any).user || {};
      if (!payload.title || !payload.type) {
        return res
          .status(400)
          .json(new ApiError(400, "Title and type are required"));
      }
      const testimonialValidationError =
        getTestimonialValidationError(payload);
      if (testimonialValidationError) {
        return res
          .status(400)
          .json(new ApiError(400, testimonialValidationError));
      }
      const videoValidationError = getVideoValidationError(payload);
      if (videoValidationError) {
        return res
          .status(400)
          .json(new ApiError(400, videoValidationError));
      }
      payload.createdByName = actor?.name || actor?.username || actor?.email;
      payload.createdByRole = actor?.role?.name || actor?.role || undefined;
      payload.editedByName = payload.createdByName;
      payload.editedByRole = payload.createdByRole;
      payload.createdOn = payload.createdOn || new Date();
      payload.createdBy = payload.createdBy || payload.createdByName;
      payload.publishedOn =
        payload.publishedOn || (payload.isActive ? new Date() : undefined);
      payload.editedAt = new Date();
      payload.editedOn = payload.editedAt;
      payload.editedBy = payload.editedBy || payload.editedByName;
      if (payload.isActive && !payload.publishedAt) {
        payload.publishedAt = new Date();
      }
      const item = await Knowledge.create(payload);
      return res
        .status(201)
        .json(new ApiResponse(201, item, "Knowledge content created"));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const payload = KnowledgeController.normalizePayload(req.body || {});
      const actor = (req as any).user || {};
      const existing = await Knowledge.findById(id).lean();
      if (!existing) {
        return res.status(404).json(new ApiError(404, "Not found"));
      }
      const testimonialValidationError = getTestimonialValidationError({
        ...existing,
        ...payload,
      });
      if (testimonialValidationError) {
        return res
          .status(400)
          .json(new ApiError(400, testimonialValidationError));
      }
      const videoValidationError = getVideoValidationError({
        ...existing,
        ...payload,
      });
      if (videoValidationError) {
        return res
          .status(400)
          .json(new ApiError(400, videoValidationError));
      }

      payload.editedByName = actor?.name || actor?.username || actor?.email;
      payload.editedByRole = actor?.role?.name || actor?.role || undefined;
      payload.editedBy = payload.editedBy || payload.editedByName;
      payload.editedAt = new Date();
      payload.editedOn = payload.editedAt;
      if (
        payload.isActive === true &&
        !payload.publishedAt &&
        !existing.publishedAt
      ) {
        payload.publishedAt = new Date();
      }
      if (
        payload.isActive === true &&
        !payload.publishedOn &&
        !existing.publishedOn
      ) {
        payload.publishedOn = new Date();
      }

      const item = await Knowledge.findByIdAndUpdate(id, payload, {
        new: true,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, item, "Knowledge content updated"));
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const item = await Knowledge.findByIdAndDelete(id);
      if (!item) return res.status(404).json(new ApiError(404, "Not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, item, "Knowledge content deleted"));
    } catch (error) {
      next(error);
    }
  }
}
