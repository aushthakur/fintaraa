import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  AppBanner,
  AppBannerActionType,
  AppBannerAudience,
  AppBannerStatus,
} from "../../modals/appBanner.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const AppBannerService = new CommonService(AppBanner);

const normalizeEnumValue = <T extends string>(
  value: any,
  allowed: readonly T[],
): T | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).trim().toLowerCase() as T;
  return allowed.includes(normalized) ? normalized : undefined;
};

const toNumber = (value: any): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const toDateOrUndefined = (value: any): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const parseActionParams = (body: Record<string, any>): any => {
  if (body.actionParams && typeof body.actionParams === "object") {
    return body.actionParams;
  }

  if (typeof body.actionParams === "string" && body.actionParams.trim()) {
    try {
      return JSON.parse(body.actionParams);
    } catch {
      return undefined;
    }
  }

  const bracketKeys = Object.keys(body).filter(
    (k) => k.startsWith("actionParams[") && k.endsWith("]"),
  );
  if (bracketKeys.length === 0) return undefined;

  const out: Record<string, any> = {};
  for (const key of bracketKeys) {
    const path = key
      .replace(/^actionParams\[/, "")
      .replace(/\]$/g, "")
      .split("][")
      .filter(Boolean);
    if (!path.length) continue;
    let cursor: any = out;
    for (let i = 0; i < path.length - 1; i += 1) {
      const p = path[i];
      if (!cursor[p] || typeof cursor[p] !== "object") cursor[p] = {};
      cursor = cursor[p];
    }
    cursor[path[path.length - 1]] = body[key];
    delete body[key];
  }

  return Object.keys(out).length ? out : undefined;
};

const normalizePayload = (input: Record<string, any>, isUpdate = false) => {
  const body: Record<string, any> = { ...input };
  const payload: Record<string, any> = {};

  // Backward-compatible key aliases
  const image = body.image ?? body.imageUrl;
  const actionValue = body.actionValue ?? body.linkUrl;
  const placement = body.placement ?? body.type;

  if (image) payload.image = image;
  if (body.title !== undefined) payload.title = body.title;
  if (body.description !== undefined) payload.description = body.description;
  if (body.buttonText !== undefined) payload.buttonText = body.buttonText;
  if (placement !== undefined) payload.placement = String(placement).trim();
  if (actionValue !== undefined) payload.actionValue = String(actionValue).trim();

  const priority = toNumber(body.priority);
  if (priority !== undefined) payload.priority = priority;

  const status = normalizeEnumValue(String(body.status || ""), Object.values(AppBannerStatus));
  if (status) payload.status = status;

  const audience = normalizeEnumValue(
    String(body.audience || ""),
    Object.values(AppBannerAudience),
  );
  if (audience) payload.audience = audience;

  const actionType = normalizeEnumValue(
    String(body.actionType || ""),
    Object.values(AppBannerActionType),
  );
  if (actionType) payload.actionType = actionType;

  const startAt = toDateOrUndefined(body.startAt);
  const endAt = toDateOrUndefined(body.endAt);
  if (startAt) payload.startAt = startAt;
  if (endAt) payload.endAt = endAt;

  const actionParams = parseActionParams(body);
  if (actionParams !== undefined) payload.actionParams = actionParams;

  if (isUpdate) {
    return payload;
  }

  return payload;
};

export class AppBannerController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = normalizePayload(req.body || {}, false);
      if (!payload.image) {
        return res.status(400).json(new ApiError(400, "image is required"));
      }
      if (!payload.placement) {
        return res.status(400).json(new ApiError(400, "placement is required"));
      }

      const result = await AppBannerService.create(payload as any);
      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to create banner"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AppBannerService.getAll({ ...req.query });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AppBannerService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "banner not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = normalizePayload(req.body || {}, true);
      const result = await AppBannerService.updateById(req.params.id, payload as any);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update banner"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AppBannerService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete banner"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
