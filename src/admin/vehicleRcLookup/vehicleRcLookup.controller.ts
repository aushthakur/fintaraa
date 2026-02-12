import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { VehicleRcLookup } from "../../modals/vehicleRcLookup.model";

const VehicleRcLookupService = new CommonService(VehicleRcLookup);

export class VehicleRcLookupController {
  static async getAllRcLookups(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "users",
            localField: "lastFetchedBy",
            foreignField: "_id",
            as: "lastFetchedUser",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "lastAccessedBy",
            foreignField: "_id",
            as: "lastAccessedUser",
          },
        },
        {
          $unwind: { path: "$lastFetchedUser", preserveNullAndEmptyArrays: true },
        },
        {
          $unwind: {
            path: "$lastAccessedUser",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            idNumber: 1,
            environment: 1,
            fetchedAt: 1,
            lastAccessedAt: 1,
            fetchCount: 1,
            accessCount: 1,
            createdAt: 1,
            updatedAt: 1,
            lastFetchedBy: "$lastFetchedUser._id",
            lastFetchedByName: "$lastFetchedUser.name",
            lastFetchedByMobile: "$lastFetchedUser.mobile",
            lastFetchedByEmail: "$lastFetchedUser.email",
            lastAccessedBy: "$lastAccessedUser._id",
            lastAccessedByName: "$lastAccessedUser.name",
            lastAccessedByMobile: "$lastAccessedUser.mobile",
            lastAccessedByEmail: "$lastAccessedUser.email",
          },
        },
      ];

      const result = await VehicleRcLookupService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "RC data fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getRcLookupById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await VehicleRcLookupService.getById(
        req.params.id,
        [
          { path: "lastFetchedBy", select: "name mobile email" },
          { path: "lastAccessedBy", select: "name mobile email" },
        ]
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "RC lookup fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async deleteRcLookupById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await VehicleRcLookupService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "RC lookup not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "RC lookup deleted successfully"));
    } catch (error) {
      next(error);
    }
  }
}
