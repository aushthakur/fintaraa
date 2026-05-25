import { NextFunction, Request, Response } from "express";
import ApiResponse from "../../utils/ApiResponse";
import { AppUsage } from "../../modals/appUsage.model";
import {
  DEFAULT_QUERY_TIMEZONE,
  parseDateInTimeZone,
} from "../../utils/helper";

const normalizeAppType = (value: any) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["b2b", "b2c", "admin"].includes(normalized) ? normalized : "";
};

export class AppUsageController {
  static async track(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const appType = normalizeAppType(req.body?.appType || req.query?.appType);
      const event = String(req.body?.event || "active").trim();
      const authUser = req.user;

      const record = await AppUsage.create({
        appType: appType || (authUser?.role === "agency" ? "b2b" : "b2c"),
        event,
        user: authUser?._id,
        userRole:
          authUser?.role === "agency" || authUser?.role === "agency_member"
            ? "Agency"
            : authUser?._id
              ? "User"
              : undefined,
        mobile: req.body?.mobile || authUser?.mobile,
        source: req.body?.source,
        deviceId: req.body?.deviceId,
        deviceInfo: req.body?.deviceInfo || {},
        metadata: req.body?.metadata || {},
        occurredAt: req.body?.occurredAt ? new Date(req.body.occurredAt) : new Date(),
      });

      return res
        .status(201)
        .json(new ApiResponse(201, record, "App usage tracked"));
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 20, 1);
      const appType = normalizeAppType(req.query.appType);
      const event = String(req.query.event || "").trim();
      const search = String(req.query.search || "").trim();
      const query: Record<string, any> = {};

      if (appType) query.appType = appType;
      if (event) query.event = event;
      if (search) {
        query.$or = [
          { mobile: { $regex: search, $options: "i" } },
          { source: { $regex: search, $options: "i" } },
          { deviceId: { $regex: search, $options: "i" } },
        ];
      }

      const start = parseDateInTimeZone(
        req.query.startDate,
        "start",
        DEFAULT_QUERY_TIMEZONE,
      );
      const end = parseDateInTimeZone(
        req.query.endDate,
        "end",
        DEFAULT_QUERY_TIMEZONE,
      );
      if (start || end) {
        query.occurredAt = {};
        if (start) query.occurredAt.$gte = start;
        if (end) query.occurredAt.$lte = end;
      }

      const skip = (page - 1) * limit;
      const [rows, totalItems] = await Promise.all([
        AppUsage.find(query).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
        AppUsage.countDocuments(query),
      ]);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            result: rows,
            pagination: {
              totalPages: Math.max(Math.ceil(totalItems / limit), 1),
              totalItems,
              currentPage: page,
              itemsPerPage: limit,
            },
          },
          "App usage fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}
