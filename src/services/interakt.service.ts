import axios from "axios";
import ApiError from "../utils/ApiError";
import { config } from "../config/config";

export type InteraktTemplatePayload = {
  countryCode: string;
  phoneNumber: string;
  campaignId?: string;
  callbackData?: string;
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

const normalizeBaseUrl = (url: string) => url.replace(/\/$/, "");

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
  console.log(buildAuthHeader(interaktConfig.authToken));
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: buildAuthHeader(interaktConfig.authToken),
      "Content-Type": "application/json",
    },
    timeout: interaktConfig.timeoutMs,
  });

  return response.data;
};
