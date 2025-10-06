import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { CleaningSchedule } from "../../modals/cleaningschedule.model";

const CleaningService = new CommonService(CleaningSchedule);

export class CleaningController {
  static async createCleaning(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CleaningService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Cleaning"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllCleanings(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline: any[] = [];

      // Lookup Room Info
      pipeline.push({
        $lookup: {
          from: "rooms",
          as: "roomInfo",
          localField: "roomId",
          foreignField: "_id",
        },
      });
      pipeline.push({
        $unwind: {
          path: "$roomInfo",
          preserveNullAndEmptyArrays: true,
        },
      });

      // Lookup Assigned User(s)
      pipeline.push({
        $lookup: {
          from: "admins",
          localField: "assignedTo",
          foreignField: "_id",
          as: "assignedUsers",
        },
      });
      pipeline.push({
        $unwind: {
          path: "$assignedUsers",
          preserveNullAndEmptyArrays: true,
        },
      });

      // Final projection
      pipeline.push({
        $project: {
          _id: 1,
          notes: 1,
          status: 1,
          priority: 1,
          isActive: 1,
          schedule: 1,
          createdAt: 1,
          updatedAt: 1,
          frequency: 1,
          description: 1,
          room: {
            _id: "$roomInfo._id",
            name: "$roomInfo.name",
          },
          cleaners: {
            _id: "$assignedUsers._id",
            email: "$assignedUsers.email",
            username: "$assignedUsers.username",
          },
        },
      });
      const result = await CleaningService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getCleaningById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await CleaningService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "Cleaning not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateCleaningById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await CleaningService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Cleaning"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteCleaningById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await CleaningService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Cleaning"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
