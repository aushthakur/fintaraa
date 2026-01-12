import { Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import ApiResponse from "../../utils/ApiResponse";
import {
  InteraktTemplatePayload,
  sendInteraktTemplateMessage,
} from "../../services/interakt.service";

const ensureString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

const ensureStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  return [];
};

export const InteraktController = {
  sendTemplateTest: async (req: Request, res: Response) => {
    const body = req.body || {};
    const countryCode =
      ensureString(body.countryCode) ||
      config.integrations.interakt.defaultCountryCode;
    const phoneNumber = ensureString(body.phoneNumber);
    const templateName = ensureString(body.templateName || body.template?.name);
    const languageCode = ensureString(
      body.languageCode || body.template?.languageCode || "en"
    );
    const directBodyValues = ensureStringArray(body.bodyValues);
    const templateBodyValues = ensureStringArray(body.template?.bodyValues);
    const bodyValues = directBodyValues.length
      ? directBodyValues
      : templateBodyValues;
    const campaignId = ensureString(body.campaignId);
    const callbackData = ensureString(body.callbackData);

    if (!phoneNumber) {
      throw new ApiError(400, "phoneNumber is required.");
    }

    if (!templateName) {
      throw new ApiError(400, "templateName is required.");
    }

    if (!bodyValues.length) {
      throw new ApiError(400, "bodyValues must be a non-empty array.");
    }

    const payload: InteraktTemplatePayload = {
      countryCode,
      phoneNumber,
      type: "Template",
      template: {
        name: templateName,
        languageCode,
        bodyValues,
      },
    };

    if (campaignId) {
      if (!isUuid(campaignId)) {
        throw new ApiError(400, "Campaign ID must be a valid UUID.");
      }
      payload.campaignId = campaignId;
    }
    if (callbackData) payload.callbackData = callbackData;

    const data = await sendInteraktTemplateMessage(payload);
    res.status(200).json(new ApiResponse(200, data, "Interakt test sent"));
  },
  sendTemplateMessage: async (req: Request, res: Response) => {
    const body = req.body || {};
    const countryCode =
      ensureString(body.countryCode) ||
      config.integrations.interakt.defaultCountryCode;
    const phoneNumber = ensureString(body.phoneNumber);
    const templateName = "lead_created";
    const languageCode = ensureString(
      body.languageCode || body.template?.languageCode || "en"
    );
    const directBodyValues = ensureStringArray(body.bodyValues);
    const templateBodyValues = ensureStringArray(body.template?.bodyValues);
    const bodyValues = directBodyValues.length
      ? directBodyValues
      : templateBodyValues;
    const campaignId = ensureString(body.campaignId);
    const callbackData = ensureString(body.callbackData);

    if (!phoneNumber) {
      throw new ApiError(400, "phoneNumber is required.");
    }

    if (!templateName) {
      throw new ApiError(400, "templateName is required.");
    }

    if (!bodyValues.length) {
      throw new ApiError(400, "bodyValues must be a non-empty array.");
    }

    const payload: InteraktTemplatePayload = {
      countryCode,
      phoneNumber,
      type: "Template",
      template: {
        bodyValues,
        languageCode,
        name: templateName,
      },
    };

    if (campaignId) {
      if (!isUuid(campaignId)) {
        throw new ApiError(400, "Campaign ID must be a valid UUID.");
      }
      payload.campaignId = campaignId;
    }
    if (callbackData) payload.callbackData = callbackData;

    const data = await sendInteraktTemplateMessage(payload);
    res.status(200).json(new ApiResponse(200, data, "Interakt message sent"));
  },
};
