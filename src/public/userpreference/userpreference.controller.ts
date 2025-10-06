import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { UserPreference } from "../../modals/userpreference.model";

const UserPreferenceService = new CommonService(UserPreference);

export class UserPreferenceController {
  static async createUserPreference(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id: userId } = (req as any).user;
      const result = await UserPreferenceService.create({ ...req.body, userId });
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create UserPreference"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllUserPreferences(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [{
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userData",
        },
      },
      { $unwind: "$userData" }
      ];
      const result = await UserPreferenceService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getUserPreferenceById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await UserPreferenceService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "UserPreference not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateUserPreferenceById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await UserPreferenceService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update UserPreference"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteUserPreferenceById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await UserPreferenceService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete UserPreference"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
