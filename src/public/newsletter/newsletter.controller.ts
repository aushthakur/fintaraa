import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import {
  INewsletterSubscription,
  NewsletterSubscription,
} from "../../modals/newsletterSubscription.model";
import {
  verifyNewsletterUnsubscribeToken,
} from "../../services/newsletterUnsubscribe.service";
import {
  CommunicationChannel,
  CommunicationOutbox,
  CommunicationOutboxStatus,
} from "../../modals/communicationOutbox.model";
import mongoose from "mongoose";
import crypto from "crypto";
import { processCommunicationOutbox } from "../../services/communicationOutbox.service";
import { verifyEmailTransporter } from "../../utils/emailService";

const NewsletterService = new CommonService<INewsletterSubscription>(
  NewsletterSubscription,
);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const cleanPath = (value: unknown) =>
  cleanText(value).replace(/^https?:\/\/[^/]+/i, "").slice(0, 240);

const csvCell = (value: unknown) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

const cleanIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item))
        .filter((item) => mongoose.isObjectIdOrHexString(item)),
    ),
  );
};

const sanitizeCampaignHtml = (value: unknown) =>
  String(value || "")
    .slice(0, 250_000)
    .replace(
      /<(script|iframe|object|embed|form|input|button|meta|base)[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<(script|iframe|object|embed|form|input|button|meta|base)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(href|src)\s*=\s*(["'])\s*(?:javascript|data:text\/html):[\s\S]*?\2/gi,
      ' $1="#"',
    )
    .trim();

const visibleHtmlText = (value: string) =>
  value
    .replace(/<style[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const cancelPendingCampaigns = async (emails: string[]) => {
  if (!emails.length) return;
  await CommunicationOutbox.updateMany(
    {
      eventName: "newsletter_campaign",
      recipient: { $in: emails },
      status: CommunicationOutboxStatus.PENDING,
    },
    {
      $set: {
        status: CommunicationOutboxStatus.CANCELLED,
        providerStatus: "cancelled_after_unsubscribe",
        lastError: "",
      },
    },
  );
};

export class NewsletterController {
  static async subscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const email = cleanText(req.body?.email).toLowerCase();

      if (!emailRegex.test(email)) {
        throw new ApiError(400, "Please enter a valid email address.");
      }

      const existing = await NewsletterSubscription.findOne({ email });
      if (existing) {
        let message = "You are already subscribed to the Fintaraa newsletter.";
        if (existing.status !== "active") {
          existing.status = "active";
          existing.subscribedAt = new Date();
          existing.unsubscribedAt = undefined;
          existing.source = cleanText(req.body?.source) || "website";
          existing.platform =
            cleanText(req.body?.platform) ||
            cleanText(req.body?.sourcePlatform) ||
            "website";
          existing.pagePath = cleanPath(req.body?.pagePath);
          existing.formSource =
            cleanText(req.body?.formSource) || "website_newsletter";
          existing.ipAddress = req.ip;
          existing.userAgent = req.get("user-agent") || "";
          await existing.save();
          message =
            "Welcome back. Your Fintaraa newsletter subscription is active again.";
        }

        return res.status(200).json(new ApiResponse(200, existing, message));
      }

      const result = await NewsletterService.create({
        email,
        status: "active",
        source: cleanText(req.body?.source) || "website",
        platform:
          cleanText(req.body?.platform) ||
          cleanText(req.body?.sourcePlatform) ||
          "website",
        pagePath: cleanPath(req.body?.pagePath),
        formSource: cleanText(req.body?.formSource) || "website_newsletter",
        subscribedAt: new Date(),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || "",
      } as Partial<INewsletterSubscription>);

      return res.status(201).json(
        new ApiResponse(
          201,
          result,
          "Thanks for subscribing. We will send helpful finance updates to your inbox.",
        ),
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        return res.status(200).json(
          new ApiResponse(
            200,
            null,
            "You are already subscribed to the Fintaraa newsletter.",
          ),
        );
      }
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $project: {
            _id: 1,
            email: 1,
            status: 1,
            source: 1,
            platform: 1,
            pagePath: 1,
            formSource: 1,
            subscribedAt: 1,
            unsubscribedAt: 1,
            ipAddress: 1,
            userAgent: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ];

      const result = await NewsletterService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Newsletter subscribers fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await NewsletterService.getById(req.params.id, false);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Newsletter subscriber fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const status = cleanText(req.query?.status);
      const query =
        status && ["active", "unsubscribed"].includes(status)
          ? { status }
          : {};
      const rows = await NewsletterSubscription.find(query)
        .sort({ subscribedAt: -1, createdAt: -1 })
        .lean();
      const header = [
        "Email",
        "Status",
        "Subscription Date",
        "Unsubscription Date",
        "Source",
        "Platform",
        "Page",
        "Form Source",
      ];
      const csv = [
        header.map(csvCell).join(","),
        ...rows.map((row) =>
          [
            row.email,
            row.status,
            row.subscribedAt?.toISOString() || "",
            row.unsubscribedAt?.toISOString() || "",
            row.source,
            row.platform,
            row.pagePath,
            row.formSource,
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fintaraa-newsletter-subscribers-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      );
      return res.status(200).send(`\uFEFF${csv}`);
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = cleanText(req.body?.status);
      if (!["active", "unsubscribed"].includes(status)) {
        return res
          .status(400)
          .json(new ApiError(400, "Status must be active or unsubscribed"));
      }
      const now = new Date();
      const result = await NewsletterSubscription.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status,
            ...(status === "active"
              ? { subscribedAt: now }
              : { unsubscribedAt: now }),
          },
          ...(status === "active" ? { $unset: { unsubscribedAt: 1 } } : {}),
        },
        { new: true, runValidators: true },
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Newsletter subscriber not found"));
      }
      if (status === "unsubscribed") {
        await cancelPendingCampaigns([result.email]);
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Subscription status updated"));
    } catch (error) {
      next(error);
    }
  }

  static async bulkUpdateStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const subscriberIds = cleanIds(req.body?.subscriberIds);
      const status = cleanText(req.body?.status);
      if (!subscriberIds.length) {
        return res
          .status(400)
          .json(new ApiError(400, "Select at least one subscriber"));
      }
      if (subscriberIds.length > 10_000) {
        return res
          .status(400)
          .json(new ApiError(400, "Maximum 10,000 subscribers per bulk action"));
      }
      if (!["active", "unsubscribed"].includes(status)) {
        return res
          .status(400)
          .json(new ApiError(400, "Status must be active or unsubscribed"));
      }

      const selected = await NewsletterSubscription.find({
        _id: { $in: subscriberIds },
      })
        .select("_id email status")
        .lean();
      const now = new Date();
      const result = await NewsletterSubscription.updateMany(
        { _id: { $in: selected.map((item) => item._id) } },
        {
          $set: {
            status,
            ...(status === "active"
              ? { subscribedAt: now }
              : { unsubscribedAt: now }),
          },
          ...(status === "active" ? { $unset: { unsubscribedAt: 1 } } : {}),
        },
      );

      if (status === "unsubscribed") {
        await cancelPendingCampaigns(selected.map((item) => item.email));
      }

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            requested: subscriberIds.length,
            matched: selected.length,
            updated: result.modifiedCount,
          },
          `${selected.length} subscriber(s) marked ${status}`,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async createCampaign(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const subscriberIds = cleanIds(req.body?.subscriberIds);
      const subject = cleanText(req.body?.subject).slice(0, 180);
      const html = sanitizeCampaignHtml(req.body?.html);

      if (!subscriberIds.length) {
        return res
          .status(400)
          .json(new ApiError(400, "Select at least one subscriber"));
      }
      if (subscriberIds.length > 5_000) {
        return res
          .status(400)
          .json(new ApiError(400, "Maximum 5,000 recipients per campaign"));
      }
      if (subject.length < 3) {
        return res
          .status(400)
          .json(new ApiError(400, "Newsletter subject is required"));
      }
      if (visibleHtmlText(html).length < 3) {
        return res
          .status(400)
          .json(new ApiError(400, "Newsletter message is required"));
      }

      const subscribers = await NewsletterSubscription.find({
        _id: { $in: subscriberIds },
        status: "active",
      })
        .select("_id email")
        .lean();
      if (!subscribers.length) {
        return res
          .status(400)
          .json(new ApiError(400, "Selected subscribers are unsubscribed"));
      }
      try {
        await verifyEmailTransporter();
      } catch {
        return res
          .status(503)
          .json(
            new ApiError(
              503,
              "Email server authentication failed. Check SMTP configuration.",
            ),
          );
      }

      const campaignId = crypto.randomUUID();
      const createdBy = (req as any)?.user;
      const now = new Date();
      const operations = subscribers.map((subscriber) => ({
        updateOne: {
          filter: {
            idempotencyKey: `newsletter:${campaignId}:${subscriber._id}`,
          },
          update: {
            $setOnInsert: {
              channel: CommunicationChannel.EMAIL,
              eventName: "newsletter_campaign",
              referenceId: campaignId,
              recipient: subscriber.email,
              payload: {
                to: subscriber.email,
                subject,
                html,
                newsletter: true,
                createdBy: createdBy?._id,
                createdByEmail: createdBy?.email,
              },
              idempotencyKey: `newsletter:${campaignId}:${subscriber._id}`,
              status: CommunicationOutboxStatus.PENDING,
              attempts: 0,
              maxAttempts: 4,
              nextAttemptAt: now,
            },
          },
          upsert: true,
        },
      }));

      await CommunicationOutbox.bulkWrite(operations, { ordered: false });
      void processCommunicationOutbox();

      return res.status(202).json(
        new ApiResponse(
          202,
          {
            campaignId,
            requested: subscriberIds.length,
            queued: subscribers.length,
            skipped: subscriberIds.length - subscribers.length,
          },
          `${subscribers.length} newsletter email(s) queued`,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getCampaignStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const campaignId = cleanText(req.params.campaignId).slice(0, 80);
      if (!campaignId) {
        return res
          .status(400)
          .json(new ApiError(400, "Campaign ID is required"));
      }
      const statusRows = await CommunicationOutbox.aggregate([
        {
          $match: {
            eventName: "newsletter_campaign",
            referenceId: campaignId,
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);
      const counts = Object.fromEntries(
        statusRows.map((item) => [item._id, item.count]),
      );
      const total = statusRows.reduce(
        (sum, item) => sum + Number(item.count || 0),
        0,
      );
      if (!total) {
        return res
          .status(404)
          .json(new ApiError(404, "Newsletter campaign not found"));
      }
      return res.status(200).json(
        new ApiResponse(
          200,
          { campaignId, total, counts },
          "Newsletter campaign delivery status fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async unsubscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const email = cleanText(req.body?.email || req.query?.email).toLowerCase();
      const token = cleanText(req.body?.token || req.query?.token);
      if (!emailRegex.test(email) || !token) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid unsubscribe link"));
      }
      if (!verifyNewsletterUnsubscribeToken(email, token)) {
        return res
          .status(403)
          .json(new ApiError(403, "Unsubscribe link is invalid"));
      }
      const now = new Date();
      const result = await NewsletterSubscription.findOneAndUpdate(
        { email },
        {
          $set: { status: "unsubscribed", unsubscribedAt: now },
          $setOnInsert: {
            email,
            subscribedAt: now,
            source: "email_unsubscribe",
            platform: "email",
            formSource: "one_click_unsubscribe",
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      await cancelPendingCampaigns([email]);

      if (req.method === "GET") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed | Fintaraa</title></head>
<body style="margin:0;background:#f4f8fb;font-family:Arial,sans-serif;color:#102f49"><main style="max-width:560px;margin:64px auto;background:#fff;padding:32px;border:1px solid #d5e4ed;border-radius:16px;text-align:center"><h1 style="margin:0 0 12px">You are unsubscribed</h1><p style="margin:0;line-height:1.6;color:#667f91">You will no longer receive Fintaraa newsletter emails at this address.</p></main></body></html>`);
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "You have been unsubscribed"));
    } catch (error) {
      next(error);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await NewsletterService.deleteById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Newsletter subscriber deleted"));
    } catch (error) {
      next(error);
    }
  }
}
