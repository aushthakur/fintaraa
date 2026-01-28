import { NextFunction, Request, Response } from "express";

import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  AppBanner,
  AppBannerStatus,
  AppBannerAudience,
} from "../../modals/appBanner.model";
import { BannerClick } from "../../modals/bannerClick.model";

function parsePlacements(input?: string): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isActiveWithinWindow(b: any, now = new Date()) {
  const startOk = !b.startAt || new Date(b.startAt) <= now;
  const endOk = !b.endAt || new Date(b.endAt) >= now;
  return startOk && endOk;
}

export class PublicAppBannerController {
  /**
   * GET /api/public/app-banners?audience=b2c&placements=home_hero,home_strip_1
   * Returns banners grouped by placement.
   */
  static async getAppBanners(req: Request, res: Response, next: NextFunction) {
    try {
      const audienceRaw = String(req.query.audience || "b2c").toLowerCase();
      const placements = parsePlacements(String(req.query.placements || ""));

      const audience: AppBannerAudience =
        audienceRaw === "b2b"
          ? AppBannerAudience.B2B
          : audienceRaw === "both"
            ? AppBannerAudience.BOTH
            : AppBannerAudience.B2C;

      const query: any = {
        status: AppBannerStatus.ACTIVE,
        audience: { $in: [audience, AppBannerAudience.BOTH] },
      };

      if (placements.length) {
        query.placement = { $in: placements };
      }

      const all = await AppBanner.find(query)
        .sort({ priority: -1, createdAt: -1 })
        .lean();

      const now = new Date();
      const filtered = all.filter((b) => isActiveWithinWindow(b, now));

      // Group by placement
      const grouped: Record<string, any[]> = {};
      for (const b of filtered) {
        const p = String((b as any).placement || "unknown");
        grouped[p] = grouped[p] || [];
        grouped[p].push(b);
      }

      // Ensure requested placements exist as keys (so client can rely on shape)
      for (const p of placements) {
        grouped[p] = grouped[p] || [];
      }

      return res
        .status(200)
        .json(new ApiResponse(200, grouped, "Banners fetched successfully"));
    } catch (err: any) {
      // If something goes wrong, keep it explicit.
      next(new ApiError(500, err?.message || "Failed to fetch banners"));
    }
  }

  /**
   * POST /api/public/app-banners/:id/click
   * Increments click count for a banner and logs detailed click data.
   */
  static async trackClick(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      const {
        placement,
        actionType,
        actionValue,
        actionParams,
        deviceInfo,
        location,
      } = req.body;

      // First, increment the click count on the banner
      const banner = await AppBanner.findByIdAndUpdate(
        id,
        { $inc: { clickCount: 1 }, $set: { lastClickedAt: new Date() } },
        { new: true },
      ).lean();

      if (!banner) {
        return res.status(404).json(new ApiError(404, "Banner not found"));
      }

      // Create detailed click log entry
      const bannerClick = new BannerClick({
        bannerId: id,
        userId: req.user?._id || null,
        sessionId: req.user?.sessionId || req.headers["x-session-id"] || null,
        placement: placement || banner.placement,
        actionType: actionType || banner.actionType,
        actionValue: actionValue || banner.actionValue,
        actionParams: actionParams || banner.actionParams,
        deviceInfo: deviceInfo || {},
        location: location || {},
      });

      await bannerClick.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            clickCount: banner.clickCount || 0,
            lastClickedAt: banner.lastClickedAt,
            clickId: bannerClick._id,
          },
          "Banner click tracked",
        ),
      );
    } catch (err: any) {
      next(new ApiError(500, err?.message || "Failed to track banner click"));
    }
  }
}
