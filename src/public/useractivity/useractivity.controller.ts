import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import useractivityModel from "../../modals/useractivity.model";

const UserActivityService = new CommonService(useractivityModel);

export class UserActivityController {
  static async createUserActivity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await UserActivityService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create UserActivity"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllUserActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await UserActivityService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getUserActivityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await UserActivityService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "UserActivity not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateUserActivityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await UserActivityService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update UserActivity"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteUserActivityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await UserActivityService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete UserActivity"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
