import axios from "axios";
import ApiError from "../utils/ApiError";
import { config } from "../config/config";

export type InteraktTemplatePayload = {
  countryCode: string;
  phoneNumber: string;
  campaignId?: string;
  callbackData?: string;
  metadata?: Record<string, any>;
  type: "Template";
  template: {
    name: string;
    languageCode: string;
    bodyValues: string[];
  };
};

const buildAuthHeader = (token: string) => {
  if (!token) return "";
  return token.startsWith("Basic ") ? token : `Basic ${token}`;
};

const normalizeBaseUrl = (url: string) => {
  const trimmed = url.replace(/\/+$/, "");
  if (trimmed.endsWith("/public/message")) {
    return `${trimmed}/`;
  }
  return `${trimmed}/public/message/`;
};

export const sendInteraktTemplateMessage = async (
  payload: InteraktTemplatePayload
) => {
  const interaktConfig = config.integrations.interakt;

  if (!interaktConfig.enabled) {
    throw new ApiError(400, "Interakt integration is disabled in config.");
  }

  if (!interaktConfig.authToken) {
    throw new ApiError(400, "Interakt auth token is missing in config.");
  }

  if (!payload?.phoneNumber || !payload?.countryCode) {
    throw new ApiError(400, "Missing countryCode or phoneNumber.");
  }

  if (!payload?.template?.name || !payload?.template?.languageCode) {
    throw new ApiError(400, "Missing template name or language code.");
  }

  const url = normalizeBaseUrl(interaktConfig.baseUrl);
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: buildAuthHeader(interaktConfig.authToken),
      "Content-Type": "application/json",
    },
    timeout: interaktConfig.timeoutMs,
  });
  if (response?.data?.result === false) {
    throw new ApiError(
      400,
      response.data?.message || "Interakt request failed."
    );
  }
  return response.data;
};
