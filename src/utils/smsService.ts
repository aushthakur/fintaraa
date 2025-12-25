import axios from "axios";
import { config } from "../config/config";

const sanitizeMessage = (message: string) => message.trim().slice(0, 500);

const parseExtraFields = (value?: string) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Airtel IQ extra fields must be valid JSON.");
  }
};

const buildAirtelPayload = (to: string, message: string) => {
  const airtelConfig = config.sms?.airtelIq;
  if (!airtelConfig) return null;

  const payload: Record<string, unknown> = {
    customerId: airtelConfig.customerId,
    [airtelConfig.toKey]: to.replace("+", ""),
    [airtelConfig.messageKey]: sanitizeMessage(message),
    messageType: airtelConfig.messageType,
  };

  if (airtelConfig.senderId) {
    payload[airtelConfig.senderKey] = airtelConfig.senderId;
  }

  if (airtelConfig.entityId) {
    payload[airtelConfig.entityIdKey] = airtelConfig.entityId;
  }

  if (airtelConfig.templateId) {
    payload[airtelConfig.templateIdKey] = airtelConfig.templateId;
  }

  return {
    payload,
    extra: parseExtraFields(airtelConfig.extraFields),
  };
};

const sendAirtelIqSMS = async (to: string, message: string) => {
  const airtelConfig = config.sms?.airtelIq;

  if (!airtelConfig?.baseUrl || !airtelConfig?.sendPath) {
    throw new Error("Airtel IQ base URL or send path is not configured.");
  }

  if (!airtelConfig.customerId) {
    throw new Error("Airtel IQ customerId is not configured.");
  }

  if (!to || !message) {
    throw new Error("Missing recipient phone number or message content.");
  }

  const built = buildAirtelPayload(to, message);
  if (!built) {
    throw new Error("Airtel IQ payload configuration is missing.");
  }

  const url = `${airtelConfig.baseUrl.replace(
    /\/$/,
    ""
  )}/${airtelConfig.sendPath.replace(/^\//, "")}`;

  const payload = { ...built.payload, ...built.extra };

  const response = await axios.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 5000,
  });

  if (config.env === "development") {
    console.log("✅ Airtel IQ SMS sent:", {
      to,
      status: response.status,
      data: response.data,
    });
  }

  return response.data;
};

/**
 * Sends an SMS using Airtel IQ with robust validation and error handling.
 * @param to - Recipient phone number in E.164 format (e.g., +91XXXXXXXXXX)
 * @param message - Message content to send
 */
export async function sendSMS({
  to,
  message,
}: {
  to: string;
  message: string;
}) {
  try {
    if (!to || !message) {
      throw new Error("Missing recipient phone number or message content.");
    }

    if (config.sms?.provider !== "airtel_iq") {
      throw new Error("Unsupported SMS provider configured.");
    }

    return await sendAirtelIqSMS(to, message);
  } catch (err: any) {
    const errorLog = {
      code: err?.code || "UNKNOWN",
      message: err?.message || "SMS Error",
      moreInfo: err?.moreInfo || "No additional info",
    };
    console.log("❌ SMS Send Error:", errorLog);
    throw new Error(
      err?.message ||
        "Something went wrong while sending SMS. Please try again later."
    );
  }
}
