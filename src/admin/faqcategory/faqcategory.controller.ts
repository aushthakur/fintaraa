import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { FaqCategory } from "../../modals/faqcategory.model";
import { CommonService } from "../../services/common.services";

const FaqCategoryService = new CommonService(FaqCategory);

export class FaqCategoryController {
  static async createFaqCategory(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await FaqCategoryService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create FaqCategory"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllFaqCategorys(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await FaqCategoryService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getFaqCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await FaqCategoryService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "FaqCategory not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateFaqCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await FaqCategoryService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update FaqCategory"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteFaqCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await FaqCategoryService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete FaqCategory"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
