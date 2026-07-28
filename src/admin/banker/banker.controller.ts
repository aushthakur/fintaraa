import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Banker } from "../../modals/banker.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { isValidObjectId } from "../../utils/helper";

const BankerService = new CommonService(Banker);

export class BankerController {
  static async createBanker(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await BankerService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create banker"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllBankers(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await BankerService.getAll({
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

  static async getBankerById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!isValidObjectId(req.params.id)) {
        return res.status(400).json(new ApiError(400, "Invalid banker id"));
      }
      const { role } = (req as any).user;
      const result = await BankerService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Banker not found"));
      if (role !== "admin" && result.status !== "active") {
        return res.status(404).json(new ApiError(404, "Banker not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateBankerById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      if (!isValidObjectId(req.params.id)) {
        return res.status(400).json(new ApiError(400, "Invalid banker id"));
      }
      const result = await BankerService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update banker"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteBankerById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      if (!isValidObjectId(req.params.id)) {
        return res.status(400).json(new ApiError(400, "Invalid banker id"));
      }
      const result = await BankerService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete banker"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
