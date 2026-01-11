import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { AppBanner } from "../../modals/appBanner.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const AppBannerService = new CommonService(AppBanner);

export class AppBannerController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AppBannerService.create(req.body);
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
      const result = await AppBannerService.updateById(req.params.id, req.body);
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
