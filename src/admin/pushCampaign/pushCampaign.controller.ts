import mongoose from "mongoose";
import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  PushCampaign,
  PushCampaignStatus,
  PushCampaignTarget,
  PushDelivery,
} from "../../modals/pushCampaign.model";
import {
  cancelPushCampaign,
  createPushCampaign,
  getPushCampaignOverview,
  retryPushCampaign,
} from "../../services/pushCampaign.service";

type AuthRequest = Request & {
  user?: { _id?: string; id?: string };
};

const positiveInteger = (value: unknown, fallback: number, maximum: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(Math.floor(number), maximum)
    : fallback;
};

const targetsFrom = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter((item) =>
          Object.values(PushCampaignTarget).includes(
            item as PushCampaignTarget,
          ),
        ),
    ),
  ) as PushCampaignTarget[];

const actionUrlFrom = (value: unknown) => {
  const url = String(value || "").trim();
  if (!url || (url.startsWith("/") && !url.startsWith("//"))) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // Return the validation response below.
  }
  throw new Error("Action URL must be a site path or HTTP(S) URL.");
};

export class PushCampaignController {
  static async overview(_req: Request, res: Response, next: NextFunction) {
    try {
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            await getPushCampaignOverview(),
            "Push audience preview fetched",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const createdBy = req.user?._id || req.user?.id;
      const title = String(req.body?.title || "").trim();
      const message = String(req.body?.message || "").trim();
      const targets = targetsFrom(req.body?.targets);
      if (!createdBy || !mongoose.isValidObjectId(createdBy)) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!title || !message || !targets.length) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Title, message, and at least one target are required.",
            ),
          );
      }
      if (title.length > 120 || message.length > 1000) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Title can be 120 and message can be 1000 characters.",
            ),
          );
      }
      const scheduledAt = req.body?.scheduledAt
        ? new Date(req.body.scheduledAt)
        : undefined;
      if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
        return res
          .status(400)
          .json(new ApiError(400, "Scheduled date is invalid."));
      }
      const campaign = await createPushCampaign({
        title,
        message,
        targets,
        createdBy,
        scheduledAt,
        actionUrl: actionUrlFrom(req.body?.actionUrl),
      });
      return res.status(201).json(
        new ApiResponse(
          201,
          campaign,
          campaign.totalRecipients
            ? `Campaign queued for ${campaign.totalRecipients} recipient(s).`
            : "Campaign saved, but no eligible push endpoints exist yet.",
        ),
      );
    } catch (error: any) {
      if (String(error?.message || "").startsWith("Action URL")) {
        return res.status(400).json(new ApiError(400, error.message));
      }
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = positiveInteger(req.query.page, 1, 100_000);
      const limit = positiveInteger(req.query.limit, 20, 100);
      const status = String(req.query.status || "");
      const query: Record<string, any> = {};
      if (
        Object.values(PushCampaignStatus).includes(
          status as PushCampaignStatus,
        )
      ) {
        query.status = status;
      }
      const [items, total] = await Promise.all([
        PushCampaign.find(query)
          .populate("createdBy", "name fullName email")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        PushCampaign.countDocuments(query),
      ]);
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            items,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.max(1, Math.ceil(total / limit)),
            },
          },
          "Push campaigns fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async deliveries(req: Request, res: Response, next: NextFunction) {
    try {
      const page = positiveInteger(req.query.page, 1, 100_000);
      const limit = positiveInteger(req.query.limit, 25, 100);
      const [items, total] = await Promise.all([
        PushDelivery.find({ campaign: req.params.id })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        PushDelivery.countDocuments({ campaign: req.params.id }),
      ]);
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { items, pagination: { page, limit, total } },
            "Push deliveries fetched",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await cancelPushCampaign(req.params.id);
      if (!campaign) {
        return res
          .status(409)
          .json(new ApiError(409, "Campaign cannot be cancelled now."));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, campaign, "Campaign cancelled"));
    } catch (error) {
      next(error);
    }
  }

  static async retry(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await retryPushCampaign(req.params.id);
      if (!campaign) {
        return res
          .status(409)
          .json(new ApiError(409, "No failed delivery can be retried."));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, campaign, "Failed deliveries queued"));
    } catch (error) {
      next(error);
    }
  }
}
