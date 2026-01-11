import { NextFunction, Request, Response } from "express";

import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { AppBanner, AppBannerAudience, AppBannerStatus } from "../../modals/appBanner.model";

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
}
