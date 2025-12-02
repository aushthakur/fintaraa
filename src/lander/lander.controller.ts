import { Request, Response, NextFunction } from "express";
import ApiResponse from "../utils/ApiResponse";
import ApiError from "../utils/ApiError";
import { LanderService } from "../services/lander.service";

export class LanderController {
  // Get lander dashboard statistics
  static async getDashboardStats(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const landerId = (req as any).user?._id;
      if (!landerId) throw new ApiError(403, "Lander not authenticated");

      const stats = await LanderService.getLanderDashboardStats(landerId);

      res.status(200).json(new ApiResponse(200, stats, "Dashboard statistics"));
    } catch (error) {
      next(error);
    }
  }
}

