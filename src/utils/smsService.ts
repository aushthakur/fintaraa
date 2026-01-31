import axios from "axios";
import { config } from "../config/config";

/**
 * Replace template variables like {otp} or {OTP}
 */
const replaceVariables = (
  message: string,
  variables?: Record<string, string | number>,
): string => {
  if (!variables) return message;

  let finalMessage = message;

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{${key}\\}`, "gi");
    finalMessage = finalMessage.replace(regex, String(value));
  });

  return finalMessage;
};

/**
 * Build Airtel IQ payload (DLT compliant)
 */
const buildAirtelPayload = (
  to: string,
  message: string,
  variables?: Record<string, string | number>,
) => {
  const airtel = config.sms?.airtelIq;

  if (!airtel) {
    throw new Error("Airtel IQ configuration missing");
  }

  if (!airtel.customerId) {
    throw new Error("Airtel IQ customerId missing");
  }

  if (!airtel.senderId) {
    throw new Error("Airtel IQ senderId missing");
  }

  // if (!airtel.entityId) {
  //   throw new Error("Airtel IQ entityId missing");
  // }

  if (!airtel.templateId) {
    throw new Error("Airtel IQ templateId missing");
  }

  const processedMessage = replaceVariables(message, variables);

  // Clean Indian mobile number
  const mobile = to.replace(/^\+?91/, "").replace(/\D/g, "");

  let extraFields: Record<string, unknown> = {};
  try {
    extraFields = JSON.parse(airtel.extraFields || "{}");
  } catch {
    extraFields = {};
  }

  const metaData =
    typeof extraFields.metaData === "object" && extraFields.metaData !== null
      ? (extraFields.metaData as Record<string, unknown>)
      : {};

  const urlShortenerParams =
    typeof extraFields.urlShortenerParams === "object" &&
    extraFields.urlShortenerParams !== null
      ? (extraFields.urlShortenerParams as Record<string, unknown>)
      : undefined;

  const messageType = airtel.messageType || "PROMOTIONAL";
  const allowedMessageTypes = new Set([
    "PROMOTIONAL",
    "TRANSACTIONAL",
    "SERVICE_IMPLICIT",
    "SERVICE_EXPLICIT",
  ]);

  if (!allowedMessageTypes.has(messageType)) {
    throw new Error(`Invalid Airtel IQ messageType: ${messageType}`);
  }

  const payload: Record<string, unknown> = {
    metaData,
    priority: false,
    destinationAddress: mobile,
    customerId: airtel.customerId,
    filterBlacklistNumbers: false,
    message: processedMessage.trim(),
    messageType,
    entityId: airtel.entityId,
    sourceAddress: airtel.senderId,
    dltTemplateId: airtel.templateId,
  };

  if (urlShortenerParams) {
    payload.urlShortenerParams = urlShortenerParams;
  }

  return payload;
};

/**
 * Send SMS via Airtel IQ
 */
const sendAirtelIqSMS = async (
  to: string,
  message: string,
  variables?: Record<string, string | number>,
) => {
  const airtel = config.sms?.airtelIq;

  if (!airtel?.baseUrl) {
    throw new Error("Airtel IQ baseUrl missing");
  }

  const payload = buildAirtelPayload(to, message, variables);
  console.log(airtel.baseUrl, payload);

  const response = await axios.post(airtel.baseUrl, payload, {
    timeout: 30000,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
  });

  if (config.env === "development") {
    console.log("✅ Airtel IQ SMS Sent", {
      to: payload.destinationAddress,
      response: response.data,
    });
  }

  return response.data;
};

/**
 * Public SMS function
 */
export async function sendSMS({ to, otp }: { to: string; otp: string }) {
  try {
    if (!config.sms?.enabled) {
      return { success: false, message: "SMS service disabled" };
    }

    if (config.sms.provider !== "airtel_iq") {
      throw new Error("Invalid SMS provider");
    }

    // ⚠️ EXACT DLT TEMPLATE TEXT
    const message =
      "{otp} is your OTP to verify your mobile number for login on Fintaraa App/Website. Valid for 1 minute..";

    return await sendAirtelIqSMS(to, message, { otp });
  } catch (err: any) {
    console.error("❌ SMS Error", {
      message: err.message,
      response: err?.response?.data,
    });

    throw new Error("Failed to send OTP SMS");
  }
}
