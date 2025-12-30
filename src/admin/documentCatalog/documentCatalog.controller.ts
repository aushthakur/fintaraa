import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { DocumentCatalog } from "../../modals/documentCatalog.model";
import { NextFunction, Request, Response } from "express";

const DocumentCatalogService = new CommonService(DocumentCatalog);
const normalizeBoolean = (value: any) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "inactive"].includes(normalized)) return false;
  }
  return value;
};
const normalizePayload = (payload: any) => {
  const next = { ...payload };
  if (next.required !== undefined) {
    next.required = normalizeBoolean(next.required);
  }
  if (next.isActive !== undefined) {
    next.isActive = normalizeBoolean(next.isActive);
  }
  return next;
};

export class DocumentCatalogController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = normalizePayload(req.body || {});
      if (!payload?.key || !payload?.label) {
        return res
          .status(400)
          .json(new ApiError(400, "Key and label are required"));
      }
      const result = await DocumentCatalogService.create(payload);
      if (!result) {
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create document"));
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
      const result = await DocumentCatalogService.getAll(req.query, [
        { $sort: { sortOrder: 1, createdAt: -1 } },
      ]);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await DocumentCatalogService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Document not found"));
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
      const result = await DocumentCatalogService.updateById(
        req.params.id,
        normalizePayload(req.body || {})
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update document"));
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
      const result = await DocumentCatalogService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete document"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
