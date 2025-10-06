import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BlogCategory } from "../../modals/blogcategory.model";

const BlogCategoryService = new CommonService(BlogCategory);

export class BlogCategoryController {
  static async createBlogCategory(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BlogCategoryService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create BlogCategory"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllBlogCategorys(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BlogCategoryService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getBlogCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await BlogCategoryService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "BlogCategory not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateBlogCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BlogCategoryService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update BlogCategory"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteBlogCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BlogCategoryService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete BlogCategory"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
