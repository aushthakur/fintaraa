import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { EngagementEvent } from "../../modals/engagementEvent.model";
import {
  DEFAULT_QUERY_TIMEZONE,
  parseDateInTimeZone,
} from "../../utils/helper";

const allowedEventTypes = new Set([
  "page_view",
  "click",
  "popup_impression",
  "banner_impression",
]);
const allowedCategories = new Set([
  "page",
  "cta",
  "banner",
  "popup",
  "phone",
  "whatsapp",
  "footer",
  "navigation",
  "other",
]);
const sensitiveQueryKeys = new Set([
  "token",
  "access_token",
  "refresh_token",
  "otp",
  "code",
  "mobile",
  "phone",
  "email",
  "pan",
  "aadhaar",
  "password",
]);

const clean = (value: unknown, max = 240) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const safeUrl = (value: unknown, max = 1200) => {
  const raw = clean(value, max);
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://fintaraa.invalid");
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (sensitiveQueryKeys.has(key.toLowerCase())) url.searchParams.delete(key);
    });
    if (url.origin === "https://fintaraa.invalid") {
      return `${url.pathname}${url.search}`.slice(0, max);
    }
    return `${url.origin}${url.pathname}${url.search}`.slice(0, max);
  } catch {
    return raw.split("#")[0].slice(0, max);
  }
};

const getPagePath = (pageUrl: string, suppliedPath: unknown) => {
  const path = safeUrl(suppliedPath, 600);
  if (path.startsWith("/")) return path.split("?")[0] || "/";
  try {
    const url = new URL(pageUrl);
    return url.pathname.slice(0, 600) || "/";
  } catch {
    return "/";
  }
};

const safeQueryParams = (value: unknown, pageUrl: string) => {
  const result: Record<string, string | string[]> = {};
  const add = (keyValue: unknown, rawValue: unknown) => {
    const key = clean(keyValue, 100);
    if (!key || sensitiveQueryKeys.has(key.toLowerCase())) return;
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .map((item) => clean(item, 500))
      .filter(Boolean)
      .slice(0, 10);
    if (!values.length) return;
    result[key] = values.length === 1 ? values[0] : values;
  };

  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value as Record<string, unknown>)
      .slice(0, 60)
      .forEach(([key, item]) => add(key, item));
  }

  try {
    const url = new URL(pageUrl, "https://fintaraa.invalid");
    Array.from(new Set(url.searchParams.keys()))
      .slice(0, 60)
      .forEach((key) => add(key, url.searchParams.getAll(key)));
  } catch {
    // The supplied structured parameters are still retained when URL parsing fails.
  }
  return result;
};

const clientIp = (req: Request) =>
  clean(
    req.get("cf-connecting-ip") ||
      req.get("x-real-ip") ||
      String(req.get("x-forwarded-for") || "").split(",")[0] ||
      req.socket.remoteAddress,
    100,
  );

const requestLocation = (req: Request) => ({
  city: clean(
    req.get("cf-ipcity") ||
      req.get("x-vercel-ip-city") ||
      req.get("x-appengine-city"),
    100,
  ),
  region: clean(
    req.get("cf-region") ||
      req.get("x-vercel-ip-country-region") ||
      req.get("x-appengine-region"),
    100,
  ),
  country: clean(
    req.get("cf-ipcountry") ||
      req.get("x-vercel-ip-country") ||
      req.get("x-appengine-country"),
    100,
  ),
});

const dateMatch = (startDate: unknown, endDate: unknown) => {
  const range: Record<string, Date> = {};
  if (typeof startDate === "string" && startDate) {
    const parsed = parseDateInTimeZone(
      startDate,
      "start",
      DEFAULT_QUERY_TIMEZONE,
    );
    if (parsed) range.$gte = parsed;
  }
  if (typeof endDate === "string" && endDate) {
    const parsed = parseDateInTimeZone(endDate, "end", DEFAULT_QUERY_TIMEZONE);
    if (parsed) range.$lte = parsed;
  }
  return Object.keys(range).length ? { createdAt: range } : {};
};

const buildAdminMatch = (query: Request["query"]) => {
  const match: Record<string, any> = {
    ...dateMatch(query.startDate, query.endDate),
  };
  [
    "eventType",
    "category",
    "deviceType",
    "source",
    "campaign",
    "city",
    "pagePath",
  ].forEach((key) => {
    const value = clean(query[key], 200);
    if (value) match[key] = value;
  });
  return match;
};

const toCsv = (rows: Array<Record<string, any>>) => {
  const headers = [
    "Date & time",
    "Event",
    "Category",
    "Page URL",
    "Element",
    "Placement",
    "Target URL",
    "Device",
    "City",
    "Region",
    "Country",
    "Source",
    "Medium",
    "Campaign",
    "Referrer",
    "Landing page",
    "Query parameters",
    "GCLID",
    "FBCLID",
    "DSA referral code",
    "Visitor type",
    "User ID",
    "Session ID",
  ];
  const escape = (value: unknown) => {
    const text = String(value ?? "").replace(/\r?\n/g, " ");
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [
    headers.map(escape).join(","),
    ...rows.map((row) =>
      [
        row.createdAt ? new Date(row.createdAt).toISOString() : "",
        row.eventType,
        row.category,
        row.pageUrl,
        row.elementName,
        row.placement,
        row.targetUrl,
        row.deviceType,
        row.city,
        row.region,
        row.country,
        row.source,
        row.medium,
        row.campaign,
        row.referrer,
        row.landingPage,
        Object.entries(row.queryParams || {})
          .map(([key, value]) =>
            `${key}=${Array.isArray(value) ? value.join("|") : value}`,
          )
          .join("&"),
        row.gclid,
        row.fbclid,
        row.dsaReferralCode,
        row.user ? "authenticated" : "anonymous",
        row.user?._id || row.user,
        row.sessionId,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
};

const mergePerformance = (
  impressions: Array<{ _id: string; count: number }>,
  clicks: Array<{ _id: string; count: number }>,
) => {
  const byName = new Map<
    string,
    { name: string; impressions: number; clicks: number; conversionRate: number }
  >();
  impressions.forEach((row) => {
    const name = row._id || "Unlabelled";
    byName.set(name, {
      name,
      impressions: row.count,
      clicks: 0,
      conversionRate: 0,
    });
  });
  clicks.forEach((row) => {
    const name = row._id || "Unlabelled";
    const current = byName.get(name) || {
      name,
      impressions: 0,
      clicks: 0,
      conversionRate: 0,
    };
    current.clicks = row.count;
    byName.set(name, current);
  });
  return Array.from(byName.values())
    .map((item) => ({
      ...item,
      conversionRate: item.impressions
        ? Number(((item.clicks / item.impressions) * 100).toFixed(2))
        : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);
};

export class EngagementController {
  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const eventType = clean(req.body?.eventType, 40);
      const category = clean(req.body?.category, 40);
      if (!allowedEventTypes.has(eventType)) {
        return res.status(400).json(new ApiError(400, "Invalid engagement event"));
      }
      if (!allowedCategories.has(category)) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid engagement category"));
      }

      const pageUrl = safeUrl(req.body?.pageUrl);
      if (!pageUrl) {
        return res.status(400).json(new ApiError(400, "Page URL is required"));
      }
      const location = requestLocation(req);
      const ip = clientIp(req);
      const queryParams = safeQueryParams(req.body?.queryParams, pageUrl);
      const payload = {
        eventType,
        category,
        pageUrl,
        pagePath: getPagePath(pageUrl, req.body?.pagePath),
        elementName: clean(req.body?.elementName, 160),
        elementId: clean(req.body?.elementId, 120),
        placement: clean(req.body?.placement, 160),
        targetUrl: safeUrl(req.body?.targetUrl),
        sessionId: clean(req.body?.sessionId, 100),
        visitorId: clean(req.body?.visitorId, 100),
        user: req.user?._id,
        deviceType: ["mobile", "desktop", "tablet"].includes(
          clean(req.body?.deviceType, 20),
        )
          ? clean(req.body?.deviceType, 20)
          : "unknown",
        ...location,
        source: clean(req.body?.source, 120),
        medium: clean(req.body?.medium, 120),
        campaign: clean(req.body?.campaign, 160),
        term: clean(req.body?.term, 160),
        content: clean(req.body?.content, 160),
        referrer: safeUrl(req.body?.referrer),
        heatmapProvider: clean(req.body?.heatmapProvider, 40),
        queryParams,
        landingPage: safeUrl(req.body?.landingPage, 1000),
        gclid: clean(req.body?.gclid, 240),
        fbclid: clean(req.body?.fbclid, 240),
        dsaReferralCode: clean(req.body?.dsaReferralCode, 40),
        metadata: {
          ...(req.body?.metadata &&
          typeof req.body.metadata === "object" &&
          !Array.isArray(req.body.metadata)
            ? req.body.metadata
            : {}),
          ipHash: ip
            ? crypto
                .createHash("sha256")
                .update(`${process.env.JWT_SECRET || "fintaraa"}:${ip}`)
                .digest("hex")
                .slice(0, 24)
            : undefined,
        },
      };
      await EngagementEvent.create(payload);
      return res
        .status(201)
        .json(new ApiResponse(201, null, "Engagement recorded"));
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const match = buildAdminMatch(req.query);
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 250);
      const [items, total] = await Promise.all([
        EngagementEvent.find(match)
          .populate("user", "name email mobile customerId")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        EngagementEvent.countDocuments(match),
      ]);
      return res.status(200).json(
        new ApiResponse(200, {
          result: items,
          pagination: {
            currentPage: page,
            itemsPerPage: limit,
            totalItems: total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  static async summary(req: Request, res: Response, next: NextFunction) {
    try {
      const base = buildAdminMatch(req.query);
      const [
        totalEvents,
        totalPageViews,
        totalClicks,
        uniqueSessions,
        topPages,
        topCtas,
        devices,
        sources,
        cities,
        daily,
        popupImpressions,
        popupClicks,
        bannerImpressions,
        bannerClicks,
        heatmapEvents,
      ] = await Promise.all([
        EngagementEvent.countDocuments(base),
        EngagementEvent.countDocuments({ ...base, eventType: "page_view" }),
        EngagementEvent.countDocuments({ ...base, eventType: "click" }),
        EngagementEvent.distinct("sessionId", {
          ...base,
          sessionId: { $nin: [null, ""] },
        }),
        EngagementEvent.aggregate([
          { $match: { ...base, eventType: "page_view" } },
          {
            $project: {
              pagePath: {
                $arrayElemAt: [{ $split: ["$pagePath", "?"] }, 0],
              },
              sessionId: 1,
            },
          },
          {
            $group: {
              _id: "$pagePath",
              views: { $sum: 1 },
              sessions: { $addToSet: "$sessionId" },
            },
          },
          {
            $project: {
              page: "$_id",
              views: 1,
              uniqueSessions: {
                $size: {
                  $filter: {
                    input: "$sessions",
                    cond: {
                      $and: [
                        { $ne: ["$$this", null] },
                        { $ne: ["$$this", ""] },
                      ],
                    },
                  },
                },
              },
            },
          },
          { $sort: { views: -1 } },
          { $limit: 15 },
        ]),
        EngagementEvent.aggregate([
          {
            $match: {
              ...base,
              eventType: "click",
              category: { $in: ["cta", "phone", "whatsapp"] },
            },
          },
          {
            $group: {
              _id: {
                name: { $ifNull: ["$elementName", "Unlabelled CTA"] },
                category: "$category",
              },
              clicks: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              name: "$_id.name",
              category: "$_id.category",
              clicks: 1,
            },
          },
          { $sort: { clicks: -1 } },
          { $limit: 20 },
        ]),
        EngagementEvent.aggregate([
          { $match: base },
          { $group: { _id: "$deviceType", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        EngagementEvent.aggregate([
          { $match: base },
          {
            $group: {
              _id: { $ifNull: ["$source", "direct"] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        EngagementEvent.aggregate([
          { $match: { ...base, city: { $nin: [null, ""] } } },
          { $group: { _id: "$city", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        EngagementEvent.aggregate([
          { $match: base },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                  timezone: DEFAULT_QUERY_TIMEZONE,
                },
              },
              pageViews: {
                $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] },
              },
              clicks: {
                $sum: { $cond: [{ $eq: ["$eventType", "click"] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        EngagementEvent.aggregate([
          { $match: { ...base, eventType: "popup_impression" } },
          {
            $group: {
              _id: { $ifNull: ["$placement", "$elementName"] },
              count: { $sum: 1 },
            },
          },
        ]),
        EngagementEvent.aggregate([
          { $match: { ...base, eventType: "click", category: "popup" } },
          {
            $group: {
              _id: { $ifNull: ["$placement", "$elementName"] },
              count: { $sum: 1 },
            },
          },
        ]),
        EngagementEvent.aggregate([
          { $match: { ...base, eventType: "banner_impression" } },
          {
            $group: {
              _id: { $ifNull: ["$placement", "$elementName"] },
              count: { $sum: 1 },
            },
          },
        ]),
        EngagementEvent.aggregate([
          { $match: { ...base, eventType: "click", category: "banner" } },
          {
            $group: {
              _id: { $ifNull: ["$placement", "$elementName"] },
              count: { $sum: 1 },
            },
          },
        ]),
        EngagementEvent.countDocuments({
          ...base,
          heatmapProvider: "clarity",
        }),
      ]);

      return res.status(200).json(
        new ApiResponse(200, {
          summary: {
            totalEvents,
            totalPageViews,
            totalClicks,
            uniqueSessions: uniqueSessions.length,
          },
          topPages,
          topCtas,
          popupPerformance: mergePerformance(popupImpressions, popupClicks),
          bannerPerformance: mergePerformance(bannerImpressions, bannerClicks),
          devices,
          sources,
          cities,
          daily,
          heatmap: {
            provider: "Microsoft Clarity",
            integrated: heatmapEvents > 0,
            trackedEvents: heatmapEvents,
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  static async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const match = buildAdminMatch(req.query);
      const rows = await EngagementEvent.find(match)
        .populate("user", "_id")
        .sort({ createdAt: -1 })
        .limit(100_000)
        .lean();
      const start = clean(req.query.startDate, 20) || "all";
      const end = clean(req.query.endDate, 20) || "all";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fintaraa-engagement-${start}-to-${end}.csv"`,
      );
      return res.status(200).send(`\uFEFF${toCsv(rows as any[])}`);
    } catch (error) {
      next(error);
    }
  }
}
