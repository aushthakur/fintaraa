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

const normalizePhone = (countryCode: string, phoneNumber: string) => {
  const normalizedCountryCode = `+${countryCode.replace(/\D/g, "")}`;
  let normalizedPhone = phoneNumber.replace(/\D/g, "");
  const countryDigits = normalizedCountryCode.slice(1);

  if (normalizedPhone.startsWith(countryDigits) && normalizedPhone.length > 10) {
    normalizedPhone = normalizedPhone.slice(countryDigits.length);
  }
  normalizedPhone = normalizedPhone.replace(/^0+/, "");

  if (!countryDigits || normalizedPhone.length < 7 || normalizedPhone.length > 15) {
    throw new ApiError(400, "Invalid countryCode or phoneNumber.");
  }

  return { countryCode: normalizedCountryCode, phoneNumber: normalizedPhone };
};

const interaktMessageId = (data: any) =>
  String(data?.messageId || data?.id || data?.data?.messageId || data?.data?.id || "")
    .trim();

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

  if (
    !Array.isArray(payload.template.bodyValues) ||
    payload.template.bodyValues.some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  ) {
    throw new ApiError(400, "Template bodyValues must be non-empty strings.");
  }

  const recipient = normalizePhone(payload.countryCode, payload.phoneNumber);
  const normalizedPayload = {
    ...payload,
    ...recipient,
    template: {
      ...payload.template,
      bodyValues: payload.template.bodyValues.map((value) => value.trim()),
    },
  };

  const url = normalizeBaseUrl(interaktConfig.baseUrl);
  const logContext = {
    to: `${recipient.countryCode}${recipient.phoneNumber}`,
    templateName: normalizedPayload.template.name,
    languageCode: normalizedPayload.template.languageCode,
    bodyValues: normalizedPayload.template.bodyValues,
    callbackData: normalizedPayload.callbackData || "",
    campaignId: normalizedPayload.campaignId || "",
  };
  console.log("[Interakt] Sending WhatsApp template to this number:", logContext);
  const response = await axios.post(url, normalizedPayload, {
    headers: {
      Authorization: buildAuthHeader(interaktConfig.authToken),
      "Content-Type": "application/json",
    },
    timeout: interaktConfig.timeoutMs,
  });
  if (response?.data?.result === false) {
    console.log("[Interakt] WhatsApp template rejected:", {
      ...logContext,
      message: response.data?.message || "Interakt request failed.",
    });
    throw new ApiError(
      400,
      response.data?.message || "Interakt request failed."
    );
  }
  console.log("[Interakt] WhatsApp template accepted:", {
    ...logContext,
    providerMessageId: interaktMessageId(response.data),
    result: response?.data?.result,
  });
  return response.data;
};
