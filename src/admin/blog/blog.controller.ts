import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import { Blog } from "../../modals/blog.model";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const BlogService = new CommonService(Blog);

export class BlogController {
  static async createBlog(req: Request, res: Response, next: NextFunction) {
    try {
      const imageUrl = req?.body?.imageUrl?.[0]?.url;
      if (!imageUrl)
        return res
          .status(403)
          .json(new ApiError(403, "Blog Image is Required."));
      const result = await BlogService.create({ ...req.body, imageUrl });
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Blog"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllBlogs(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [{
        $lookup: {
          from: "blogcategories",
          localField: "categoryId",
          foreignField: "_id",
          as: "categoryData",
        },
      },
      { $unwind: "$categoryData" },
      {
        $project: {
          _id: 1,
          slug: 1,
          title: 1,
          isActive: 1,
          imageUrl: 1,
          createdAt: 1,
          updatedAt: 1,
          categoryName: "$categoryData.name",
        },
      }];
      const result = await BlogService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getBlogById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await BlogService.getById(req.params.id, false);
      if (!result)
        return res.status(404).json(new ApiError(404, "Blog not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateBlogById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id;
      const imageUrl = req?.body?.imageUrl?.[0]?.url;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res
          .status(400)
          .json(new ApiError(400, "Invalid police verification doc ID"));

      const record = await BlogService.getById(id);
      if (!record) {
        return res
          .status(404)
          .json(new ApiError(404, "Job Requirement (On Demand) not found."));
      }

      let image;
      if (req?.body?.image && record.imageUrl)
        image = await extractImageUrl(
          req?.body?.image,
          record.imageUrl as string
        );

      const result = await BlogService.updateById(req.params.id, {
        ...req.body,
        image: image || imageUrl,
      });
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Blog"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteBlogById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BlogService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Blog"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
