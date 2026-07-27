import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  Banner,
  BannerStatus,
  BannerType,
  PRODUCT_SCOPED_BANNER_TYPES,
  RESPONSIVE_BANNER_TYPES,
  isUploadedBannerMediaUrl,
} from "../../modals/banner.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const BannerService = new CommonService(Banner);

const normalizeProductSlug = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export class BannerController {
  static async getPublicHomepageBanners(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await Banner.find({
        type: BannerType.HOMEPAGE,
        status: BannerStatus.ACTIVE,
        image: /^https?:\/\//i,
      })
        .sort({ priority: 1, createdAt: -1 })
        .limit(Math.max(Math.min(Number(req.query.limit || 10), 20), 1))
        .lean();

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Banners fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPublicBannersByType(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const type = String(req.params.type || "").toLowerCase() as BannerType;

      if (!Object.values(BannerType).includes(type)) {
        return res.status(400).json(new ApiError(400, "Invalid banner type"));
      }

      const productSlug = normalizeProductSlug(req.query.productSlug);

      const rows = await Banner.find({
        type,
        status: BannerStatus.ACTIVE,
        ...(productSlug ? { productSlug } : {}),
      })
        .sort({ priority: 1, createdAt: -1 })
        .limit(Math.max(Math.min(Number(req.query.limit || 10), 20), 1))
        .lean();
      const isProductBanner = PRODUCT_SCOPED_BANNER_TYPES.includes(
        type as (typeof PRODUCT_SCOPED_BANNER_TYPES)[number],
      );
      const isResponsiveBanner = RESPONSIVE_BANNER_TYPES.includes(
        type as (typeof RESPONSIVE_BANNER_TYPES)[number],
      );
      const result = isProductBanner
        ? rows.filter(
            (banner) =>
              isUploadedBannerMediaUrl(banner.image) &&
              (!isResponsiveBanner ||
                isUploadedBannerMediaUrl(banner.mobileImage)),
          )
        : rows;

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Banners fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createBanner(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.body.productSlug) {
        req.body.productSlug = normalizeProductSlug(req.body.productSlug);
      }
      const result = await BannerService.create(req.body);
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
    next: NextFunction,
  ) {
    try {
      if (req.body.productSlug) {
        req.body.productSlug = normalizeProductSlug(req.body.productSlug);
      }
      const result = await BannerService.updateById(req.params.id, req.body);
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
    next: NextFunction,
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
