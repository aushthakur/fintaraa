import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Review } from "../../modals/review.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const ReviewService = new CommonService(Review);

export class ReviewController {
  static async createReview(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: user } = (req as any).user;
      const {
        title,
        rating,
        comment,
        booking,
        property,
        images = [],
      } = req.body;

      const imageUrls = Array.isArray(images)
        ? images.map((img: any) => img.url).filter((url: string) => !!url)
        : [];

      const data = {
        user,
        title,
        rating,
        comment,
        booking,
        property,
        images: imageUrls,
      };
      const result = await ReviewService.create(data);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Review"));

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ReviewService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getReviewsByBookingId(req: Request, res: Response, next: NextFunction) {
    try {
      const { property, booking } = req.body;
      if (!property && !booking) {
        return res
          .status(400)
          .json(new ApiError(400, "Property ID or Booking ID is required"));
      }

      const result = await Review.findOne({ property, booking });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getReviewById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await ReviewService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "Review not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateReviewById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ReviewService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Review"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteReviewById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ReviewService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Review"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
