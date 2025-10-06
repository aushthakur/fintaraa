import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { Coupon, CouponStatus, CouponType } from "../../modals/coupon.model";

const CouponService = new CommonService(Coupon);

export class CouponController {
  static async createCoupon(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CouponService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Coupon"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllCoupons(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CouponService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPublicCoupons(req: Request, res: Response, next: NextFunction) {
    try {
      const now = new Date();

      const pipeline: any[] = [
        {
          $match: {
            isPublic: true,
            endDate: { $gte: now },
            startDate: { $lte: now },
            status: CouponStatus.ACTIVE,
            $or: [
              { usageLimit: { $exists: false } },
              { usageLimit: { $gt: 0 } },
            ],
          },
        },
        {
          $addFields: {
            isExpired: { $lt: ["$endDate", now] },
            isUpcoming: { $gt: ["$startDate", now] },
            discountLabel: {
              $cond: [
                { $eq: ["$type", CouponType.FLAT] },
                { $concat: ["Flat ₹", { $toString: "$discountValue" }, " OFF"] },
                { $concat: [{ $toString: "$discountValue" }, "% OFF"] },
              ],
            },
          },
        },
        { $sort: { endDate: 1, createdAt: -1 } },
        {
          $project: {
            _id: 1,
            code: 1,
            type: 1,
            title: 1,
            endDate: 1,
            startDate: 1,
            usageLimit: 1,
            description: 1,
            discountValue: 1,
            discountLabel: 1,
            minBookingAmount: 1,
            maxDiscountAmount: 1,
            usageLimitPerUser: 1,
          },
        },
      ];

      const result = await CouponService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Valid coupons fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getCouponById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await CouponService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "Coupon not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateCouponById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await CouponService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Coupon"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteCouponById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await CouponService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Coupon"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
