import ApiError from "../../utils/ApiError";
import { Faq } from "../../modals/faq.model";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const FaqService = new CommonService(Faq);

export class FaqController {
  static async createFaq(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await FaqService.create(req.body);
      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to create Faq"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllFaqs(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "faqcategories",
            localField: "category",
            foreignField: "_id",
            as: "categoryData",
          },
        },
        { $unwind: "$categoryData" },
        {
          $project: {
            _id: 1,
            answer: 1,
            question: 1,
            isActive: 1,
            createdAt: 1,
            updatedAt: 1,
            categoryName: "$categoryData.name",
          },
        },
      ];
      const result = await FaqService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getFaqById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await FaqService.getById(req.params.id, role !== "admin");
      if (!result)
        return res.status(404).json(new ApiError(404, "Faq not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateFaqById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await FaqService.updateById(req.params.id, req.body);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to update Faq"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteFaqById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await FaqService.deleteById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete Faq"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
