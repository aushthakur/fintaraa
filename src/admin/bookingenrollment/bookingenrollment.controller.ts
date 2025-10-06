import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BookingEnrollment } from "../../modals/bookingenrollment.model";

const EnrollmentService = new CommonService(BookingEnrollment);

export class EnrollmentController {
  static async getAllEnrollments(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role, id: userId } = (req as any).user;
      const pipeline = [
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "userDetails",
          },
        },
        {
          $unwind: {
            path: "$userDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "plans",
            localField: "planId",
            foreignField: "_id",
            as: "planDetails",
          },
        },
        {
          $unwind: {
            path: "$planDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            totalDurationDays: {
              $cond: [
                { $and: ["$startDate", "$endDate"] },
                {
                  $dateDiff: {
                    startDate: "$startDate",
                    endDate: "$endDate",
                    unit: "day",
                  },
                },
                null, // if dates are missing
              ],
            },
            remainingDays: {
              $cond: [
                {
                  $or: [
                    { $not: "$endDate" }, // no end date
                    { $not: "$startDate" }, // no start date
                    { $gt: ["$startDate", new Date()] }, // starts in future
                  ],
                },
                0,
                {
                  $cond: [
                    { $gt: ["$endDate", new Date()] },
                    {
                      $dateDiff: {
                        startDate: new Date(),
                        endDate: "$endDate",
                        unit: "day",
                      },
                    },
                    0, // expired
                  ],
                },
              ],
            },
          },
        },
      ];

      const result = await EnrollmentService.getAll(
        {
          ...req.query,
          ...(role === "property" ? { userId } : {}),
        },
        pipeline
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getEnrollmentById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await EnrollmentService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Enrollment not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteEnrollmentById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await EnrollmentService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Enrollment"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
