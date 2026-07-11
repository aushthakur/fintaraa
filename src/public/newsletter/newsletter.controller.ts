import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import {
  INewsletterSubscription,
  NewsletterSubscription,
} from "../../modals/newsletterSubscription.model";

const NewsletterService = new CommonService<INewsletterSubscription>(
  NewsletterSubscription,
);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const cleanPath = (value: unknown) =>
  cleanText(value).replace(/^https?:\/\/[^/]+/i, "").slice(0, 240);

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
