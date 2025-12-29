import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Contest } from "../../modals/contest.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const ContestService = new CommonService(Contest);

export class ContestController {
  static async createContest(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ContestService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create contest"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllContests(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await ContestService.getAll({
        ...req.query,
        ...(role === "admin" ? {} : { status: "active" }),
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getContestById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ContestService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Contest not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateContestById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ContestService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update contest"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteContestById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ContestService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete contest"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
