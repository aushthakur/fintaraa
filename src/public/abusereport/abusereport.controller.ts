import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { AbuseReport } from "../../modals/abusereport.model";
import { CommonService } from "../../services/common.services";

const abuseReportService = new CommonService(AbuseReport);

export class AbuseReportController {
  static async createAbuseReport(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { id: user } = (req as any).user;
      const ipAddress =
        req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
        req.socket.remoteAddress;

      const data = {
        ipAddress,
        ...req.body,
        reportedBy: user,
      };
      const result = await abuseReportService.create(data);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create abuse report"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllAbuseReports(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "users",
            localField: "reportedBy",
            foreignField: "_id",
            as: "userDetails",
          },
        },
        { $unwind: "$userDetails" },
        {
          $project: {
            _id: 1,
            status: 1,
            reason: 1,
            severity: 1,
            createdAt: 1,
            ipAddress: 1,
            reviewedAt: 1,
            coordinates: 1,
            "userDetails.name": 1,
            "userDetails.role": 1,
            "userDetails.email": 1,
            "userDetails.mobile": 1,
          },
        },
      ];
      const result = await abuseReportService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAbuseReportById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await abuseReportService.getById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "abuse report not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateAbuseReportById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { status, resolutionNotes } = req.body;
      const result = await abuseReportService.updateById(req.params.id, {
        status,
        resolutionNotes,
      });
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update abuse report"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteAbuseReportById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await abuseReportService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete abuse report"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
