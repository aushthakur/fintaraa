import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { ConsentHistory, IConsentEvent } from "../../modals/consentHistory.model";
import { CommonService } from "../../services/common.services";

const ConsentService = new CommonService<IConsentEvent>(ConsentHistory as any);

export class ConsentController {
  static async logEvent(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const payload = {
        ...req.body,
        user: userId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        collectedAt: req.body?.collectedAt || new Date(),
      };
      const result = await ConsentService.create(payload as any);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Consent event recorded"));
    } catch (err) {
      next(err);
    }
  }

  static async listEvents(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const query = {
        ...req.query,
        user: userId,
        sortKey: "collectedAt",
        sortDir: "desc",
      };
      const result = await ConsentService.getAll(query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }
}
