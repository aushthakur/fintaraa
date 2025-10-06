import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Banner } from "../../modals/banner.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { extractImageUrl } from "../../utils/helper";

const BannerService = new CommonService(Banner);

export class BannerController {
  static async createBanner(req: Request, res: Response, next: NextFunction) {
    try {
      const image = req?.body?.image?.[0]?.url;
      if (!image)
        return res
          .status(403)
          .json(new ApiError(403, "Banner Image is Required."));
      const result = await BannerService.create({ ...req.body, image });
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create banner"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllBanners(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await BannerService.getAll({
        ...req.query,
        ...(role === "admin" ? {} : { status: "active" }),
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getBannerById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await BannerService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "banner not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateBannerById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id;
      const image = req?.body?.image?.[0]?.url;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res
          .status(400)
          .json(new ApiError(400, "Invalid banner doc ID"));

      const record = await BannerService.getById(id);
      if (!record) {
        return res
          .status(404)
          .json(new ApiError(404, "Job Requirement (On Demand) not found."));
      }

      let imageUrl;
      if (req?.body?.image && record.image)
        imageUrl = await extractImageUrl(
          req?.body?.image,
          record.image as string
        );

      const result = await BannerService.updateById(req.params.id, {
        ...req.body,
        image: imageUrl || image,
      });
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

  static async deleteBannerById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BannerService.deleteById(req.params.id);
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
