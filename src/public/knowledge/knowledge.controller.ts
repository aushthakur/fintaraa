import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { Knowledge } from "../../modals/knowledge.model";
import { CommonService } from "../../services/common.services";

const normalizeType = (value?: string) => {
  if (!value) return undefined;
  return value.toString().toLowerCase().trim();
};

const knowledgeService = new CommonService(Knowledge);

const buildPublicQuery = (query: Record<string, any>) => {
  const normalizedType = normalizeType(query.type);
  return {
    ...query,
    ...(normalizedType ? { type: normalizedType } : {}),
    isActive: true,
  };
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
    return next;
  }
  static async getAllPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildPublicQuery(req.query as Record<string, any>);
      const items = await knowledgeService.getAll(query);
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
      const items = await knowledgeService.getAll(query);
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
      const item = await Knowledge.findOne({ slug }).lean();
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
      payload.createdByName = actor?.name || actor?.username || actor?.email;
      payload.createdByRole = actor?.role?.name || actor?.role || undefined;
      payload.editedByName = payload.createdByName;
      payload.editedByRole = payload.createdByRole;
      payload.editedAt = new Date();
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
      payload.editedByName = actor?.name || actor?.username || actor?.email;
      payload.editedByRole = actor?.role?.name || actor?.role || undefined;
      payload.editedAt = new Date();
      if (payload.isActive && !payload.publishedAt) {
        payload.publishedAt = new Date();
      }
      const item = await Knowledge.findByIdAndUpdate(id, payload, {
        new: true,
      });
      if (!item) return res.status(404).json(new ApiError(404, "Not found"));
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
