import { Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { config } from "../../config/config";
import {
  InteraktTemplatePayload,
  sendInteraktTemplateMessage,
} from "../../services/interakt.service";

const ensureString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

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

    if (campaignId) payload.campaignId = campaignId;
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
    const templateName = ensureString(body.template?.name);
    const languageCode = ensureString(body.template?.languageCode || "en");
    const bodyValues = ensureStringArray(body.template?.bodyValues);
    const campaignId = ensureString(body.campaignId);
    const callbackData = ensureString(body.callbackData);

    if (!phoneNumber) {
      throw new ApiError(400, "phoneNumber is required.");
    }

    if (!templateName) {
      throw new ApiError(400, "template.name is required.");
    }

    if (!bodyValues.length) {
      throw new ApiError(400, "template.bodyValues must be a non-empty array.");
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

    if (campaignId) payload.campaignId = campaignId;
    if (callbackData) payload.callbackData = callbackData;

    const data = await sendInteraktTemplateMessage(payload);
    res.status(200).json(new ApiResponse(200, data, "Interakt message sent"));
  },
};
