import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { BannerClick } from "../../modals/bannerClick.model";
import { AppBanner } from "../../modals/appBanner.model";
import {
  DEFAULT_QUERY_TIMEZONE,
  parseDateInTimeZone,
} from "../../utils/helper";

interface DateRange {
  start?: Date;
  end?: Date;
}

export class BannerClickController {
  /**
   * GET /api/admin/banner-clicks
   * Get banner clicks with filtering and pagination
   */
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = 1,
        limit = 50,
        bannerId,
        placement,
        userId,
        actionType,
        startDate,
        endDate,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const query: any = {};

      if (bannerId) {
        query.bannerId = bannerId;
      }

      if (placement) {
        query.placement = placement;
      }

      if (userId) {
        query.userId = userId;
      }

      if (actionType) {
        query.actionType = actionType;
      }

      // Date range filter
      const dateRange: DateRange = {};
      if (startDate) {
        dateRange.start = parseDateInTimeZone(
          startDate,
          "start",
          DEFAULT_QUERY_TIMEZONE,
        ) || undefined;
      }
      if (endDate) {
        dateRange.end = parseDateInTimeZone(
          endDate,
          "end",
          DEFAULT_QUERY_TIMEZONE,
        ) || undefined;
      }

      if (dateRange.start || dateRange.end) {
        query.createdAt = {};
        if (dateRange.start) {
          (query.createdAt as any).$gte = dateRange.start;
        }
        if (dateRange.end) {
          (query.createdAt as any).$lte = dateRange.end;
        }
      }

      const skip = (Number(page) - 1) * Number(limit);
      const sortOptions: any = {};
      sortOptions[sortBy as string] = sortOrder === "asc" ? 1 : -1;

      const [clicks, total] = await Promise.all([
        BannerClick.find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(Number(limit))
          .populate("bannerId", "title placement image")
          .populate("userId", "fullName email mobile")
          .lean(),
        BannerClick.countDocuments(query),
      ]);

      // Transform for admin table
      const transformedClicks = clicks.map((click) => ({
        ...click,
        createdAt: click.createdAt?.toISOString(),
        updatedAt: click.updatedAt?.toISOString(),
        bannerId: click.bannerId?._id || click.bannerId,
        bannerTitle: (click.bannerId as any)?.title,
        placement: click.placement,
        actionType: click.actionType,
        userId: click.userId?._id || click.userId,
        userFullName: (click.userId as any)?.fullName,
        userMobile: (click.userId as any)?.mobile,
      }));

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            data: transformedClicks,
            pagination: {
              page: Number(page),
              limit: Number(limit),
              total,
              pages: Math.ceil(total / Number(limit)),
            },
          },
          "Banner clicks fetched successfully",
        ),
      );
    } catch (err: any) {
      next(new ApiError(500, err?.message || "Failed to fetch banner clicks"));
    }
  }

  /**
   * GET /api/admin/banner-clicks/stats
   * Get aggregated statistics for banner clicks
   */
  static async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, groupBy = "placement" } = req.query;

      const matchStage: any = {};

      // Date range filter
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) {
          const parsedStart = parseDateInTimeZone(
            startDate,
            "start",
            DEFAULT_QUERY_TIMEZONE,
          );
          if (parsedStart) (matchStage.createdAt as any).$gte = parsedStart;
        }
        if (endDate) {
          const parsedEnd = parseDateInTimeZone(
            endDate,
            "end",
            DEFAULT_QUERY_TIMEZONE,
          );
          if (parsedEnd) (matchStage.createdAt as any).$lte = parsedEnd;
        }
      }

      // Get total clicks
      const totalClicks = await BannerClick.countDocuments(matchStage);

      // Get unique users who clicked
      const uniqueUsers = await BannerClick.distinct("userId", {
        ...matchStage,
        userId: { $ne: null },
      });

      // Get clicks grouped by placement
      const clicksByPlacement = await BannerClick.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$placement",
            clicks: { $sum: 1 },
            uniqueUsers: { $addToSet: "$userId" },
          },
        },
        {
          $project: {
            placement: "$_id",
            clicks: 1,
            uniqueUsers: {
              $size: {
                $filter: {
                  input: "$uniqueUsers",
                  cond: { $ne: ["$$this", null] },
                },
              },
            },
          },
        },
        { $sort: { clicks: -1 } },
      ]);

      // Get clicks grouped by action type
      const clicksByActionType = await BannerClick.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$actionType",
            clicks: { $sum: 1 },
          },
        },
        { $sort: { clicks: -1 } },
      ]);

      // Get top banners by clicks
      const topBanners = await BannerClick.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$bannerId",
            clicks: { $sum: 1 },
            uniqueUsers: { $addToSet: "$userId" },
            lastClickedAt: { $max: "$createdAt" },
          },
        },
        {
          $project: {
            bannerId: "$_id",
            clicks: 1,
            uniqueUsers: {
              $size: {
                $filter: {
                  input: "$uniqueUsers",
                  cond: { $ne: ["$$this", null] },
                },
              },
            },
            lastClickedAt: 1,
          },
        },
        { $sort: { clicks: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "appbanners",
            localField: "bannerId",
            foreignField: "_id",
            as: "banner",
          },
        },
        {
          $unwind: {
            path: "$banner",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            bannerId: 1,
            clicks: 1,
            uniqueUsers: 1,
            lastClickedAt: 1,
            bannerTitle: "$banner.title",
            bannerPlacement: "$banner.placement",
            bannerImage: "$banner.image",
          },
        },
      ]);

      // Get clicks trend over time
      const clicksTrend = await BannerClick.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            clicks: { $sum: 1 },
            uniqueUsers: { $addToSet: "$userId" },
          },
        },
        {
          $project: {
            date: {
              $dateFromParts: {
                year: "$_id.year",
                month: "$_id.month",
                day: "$_id.day",
              },
            },
            clicks: 1,
            uniqueUsers: {
              $size: {
                $filter: {
                  input: "$uniqueUsers",
                  cond: { $ne: ["$$this", null] },
                },
              },
            },
          },
        },
        { $sort: { date: 1 } },
      ]);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            summary: {
              totalClicks,
              uniqueUsers: uniqueUsers.length,
              avgClicksPerUser:
                uniqueUsers.length > 0
                  ? (totalClicks / uniqueUsers.length).toFixed(2)
                  : 0,
            },
            clicksByPlacement,
            clicksByActionType,
            topBanners,
            clicksTrend,
          },
          "Banner click statistics fetched successfully",
        ),
      );
    } catch (err: any) {
      next(
        new ApiError(
          500,
          err?.message || "Failed to fetch banner click statistics",
        ),
      );
    }
  }

  /**
   * GET /api/admin/banner-clicks/:id
   * Get single banner click details
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const click = await BannerClick.findById(id)
        .populate("bannerId", "title placement image actionType actionValue")
        .populate("userId", "fullName email mobile")
        .lean();

      if (!click) {
        return res
          .status(404)
          .json(new ApiError(404, "Banner click not found"));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, click, "Banner click fetched successfully"));
    } catch (err: any) {
      next(new ApiError(500, err?.message || "Failed to fetch banner click"));
    }
  }

  /**
   * DELETE /api/admin/banner-clicks
   * Delete banner clicks (for cleanup)
   */
  static async deleteMany(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids, olderThan } = req.body;

      const deleteQuery: any = {};

      if (ids && Array.isArray(ids)) {
        deleteQuery._id = { $in: ids };
      }

      if (olderThan) {
        const date = new Date(olderThan);
        if (!isNaN(date.getTime())) {
          deleteQuery.createdAt = { $lt: date };
        }
      }

      const result = await BannerClick.deleteMany(deleteQuery);

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { deletedCount: result.deletedCount },
            "Banner clicks deleted successfully",
          ),
        );
    } catch (err: any) {
      next(new ApiError(500, err?.message || "Failed to delete banner clicks"));
    }
  }
}
