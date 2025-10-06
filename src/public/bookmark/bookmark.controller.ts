import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Bookmark } from "../../modals/bookmark.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const BookMarkService = new CommonService(Bookmark);

export class BookMarkController {
  static async createBookMark(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: user } = (req as any).user;
      const { property, room } = req.body;

      // Validate at least one field present
      if (!property && !room) {
        return res.status(400).json(new ApiError(400, "Either property or room must be provided for a bookmark."));
      }

      // Check for duplicate before inserting
      const existingBookmark = await Bookmark.findOne({
        user,
        room: room || null,
        property: property || null,
      });

      if (existingBookmark) {
        return res.status(409).json(new ApiError(409, "Bookmark already exists."));
      }

      const result = await BookMarkService.create({ ...req.body, user });

      if (!result) {
        return res.status(400).json(new ApiError(400, "Failed to create bookmark."));
      }

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Bookmark created successfully."));
    } catch (err: any) {
      // Handle duplicate key error (in case race condition bypasses check)
      if (err.code === 11000) {
        return res.status(409).json(new ApiError(409, "Bookmark already exists."));
      }
      next(err);
    }
  }

  static async getAllBookMarks(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userData",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  name: 1,
                  email: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$userData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "properties",
            localField: "property",
            foreignField: "_id",
            as: "propertyData",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  title: 1,
                  propertyType: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$propertyData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "rooms",
            localField: "room",
            foreignField: "_id",
            as: "roomData",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  name: 1,
                  type: 1,
                  price: 1,
                  floor: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$roomData",
            preserveNullAndEmptyArrays: true,
          },
        },
      ];
      const result = await BookMarkService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getBookMarkById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await BookMarkService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "BookMark not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateBookMarkById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BookMarkService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update BookMark"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteBookMarkById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BookMarkService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete BookMark"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
