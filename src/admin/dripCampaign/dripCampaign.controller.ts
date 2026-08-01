import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  CommunicationChannel,
  CommunicationOutbox,
} from "../../modals/communicationOutbox.model";
import { DripCampaign } from "../../modals/dripCampaign.model";

const normalizeSteps = (value: unknown) => {
  if (!Array.isArray(value)) throw new ApiError(400, "Steps must be an array");
  return value.map((raw: any, index) => {
    const channels = Array.isArray(raw?.channels)
      ? raw.channels.filter((channel: string) =>
          Object.values(CommunicationChannel).includes(
            channel as CommunicationChannel,
          ),
        )
      : [];
    const delayMinutes = Number(raw?.delayMinutes);
    if (!Number.isFinite(delayMinutes) || delayMinutes < 5) {
      throw new ApiError(
        400,
        `Step ${index + 1} delay must be at least 5 minutes`,
      );
    }
    if (!channels.length) {
      throw new ApiError(400, `Step ${index + 1} needs at least one channel`);
    }
    return {
      ...(raw?._id ? { _id: raw._id } : {}),
      name: String(raw?.name || `Step ${index + 1}`)
        .trim()
        .slice(0, 120),
      delayMinutes,
      channels,
      emailSubject: String(raw?.emailSubject || "").trim().slice(0, 240),
      emailHtml: String(raw?.emailHtml || "").slice(0, 100_000),
      smsTemplateId: String(raw?.smsTemplateId || "").trim().slice(0, 120),
      smsMessage: String(raw?.smsMessage || "").slice(0, 1000),
      whatsappTemplateName: String(raw?.whatsappTemplateName || "")
        .trim()
        .slice(0, 120),
      actionUrl: String(raw?.actionUrl || "").trim().slice(0, 1000),
    };
  });
};

export class DripCampaignController {
  static async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const campaigns = await DripCampaign.find().sort({ createdAt: 1 }).lean();
      return res
        .status(200)
        .json(new ApiResponse(200, campaigns, "Drip campaigns fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const campaign = await DripCampaign.create({
        name: String(req.body?.name || "Application recovery").trim(),
        trigger: "application_abandoned",
        isActive: req.body?.isActive !== false,
        steps: normalizeSteps(req.body?.steps || []),
        createdBy: req.user?._id,
        updatedBy: req.user?._id,
      });
      return res
        .status(201)
        .json(new ApiResponse(201, campaign, "Drip campaign created"));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request | any, res: Response, next: NextFunction) {
    try {
      const campaign = await DripCampaign.findByIdAndUpdate(
        req.params.id,
        {
          name: String(req.body?.name || "Application recovery").trim(),
          isActive: req.body?.isActive !== false,
          steps: normalizeSteps(req.body?.steps || []),
          updatedBy: req.user?._id,
        },
        { new: true, runValidators: true },
      );
      if (!campaign) {
        return res
          .status(404)
          .json(new ApiError(404, "Drip campaign not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, campaign, "Drip campaign updated"));
    } catch (error) {
      next(error);
    }
  }

  static async deliverySummary(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const rows = await CommunicationOutbox.aggregate([
        { $match: { eventName: "application_abandoned_drip" } },
        {
          $group: {
            _id: { channel: "$channel", status: "$status" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.channel": 1, "_id.status": 1 } },
      ]);
      return res
        .status(200)
        .json(new ApiResponse(200, rows, "Drip delivery summary fetched"));
    } catch (error) {
      next(error);
    }
  }
}
