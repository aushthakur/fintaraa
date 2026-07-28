import axios from "axios";
import { config } from "../config/config";
import { logger } from "../config/logger";

export type SmsDispatchResult =
  | {
      success: true;
      provider: "airtel_iq";
      response: unknown;
    }
  | {
      success: false;
      provider: string;
      reason: string;
    };

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const maskMobileForLogs = (value: string): string => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "unknown";
  if (digits.length <= 4) return `***${digits}`;
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
};

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

  if (!airtel.templateId) {
    throw new Error("Airtel IQ templateId missing");
  }

  const processedMessage = replaceVariables(message, variables);

  // Clean Indian mobile number
  const mobile = to.replace(/^\+?91/, "").replace(/\D/g, "");

  const messageType = airtel.messageType || "SERVICE_IMPLICIT";
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
    customerId: airtel.customerId,
    destinationAddress: [mobile],
    dltTemplateId: airtel.templateId,
    entityId: airtel.entityId,
    message: processedMessage.trim(),
    messageType,
    sourceAddress: airtel.senderId,
  };

  return payload;
};

/**
 * Send SMS via Airtel IQ
 */
const sendAirtelIqSMS = async (
  to: string,
  message: string,
  variables?: Record<string, string | number>,
): Promise<unknown> => {
  const airtel = config.sms?.airtelIq;

  if (!airtel?.baseUrl) {
    throw new Error("Airtel IQ baseUrl missing");
  }

  const payload = buildAirtelPayload(to, message, variables);
  logger.info(
    `[SMS][AirtelIQ] Sending SMS to=${maskMobileForLogs(to)} templateId=${airtel.templateId}`,
  );

  const response = await axios.post(airtel.baseUrl, payload, {
    timeout: 10000,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
  });

  logger.info(
    `[SMS][AirtelIQ] SMS sent to=${maskMobileForLogs(to)} status=${response.status}`,
  );
  if (config.env === "development")
    logger.info(
      `[SMS][AirtelIQ] Response payload=${safeStringify(response.data)}`,
    );

  return response.data;
};

/**
 * Public SMS function
 */
export async function sendSMS({
  to,
  otp,
}: {
  to: string;
  otp: string;
}): Promise<SmsDispatchResult> {
  const maskedTo = maskMobileForLogs(to);

  try {
    if (!to || !otp) {
      throw new Error("SMS payload requires both 'to' and 'otp'");
    }

    if (!config.sms?.enabled) {
      logger.warn(
        `[SMS] Skipped OTP SMS because service is disabled to=${maskedTo}`,
      );
      return {
        success: false,
        provider: config.sms?.provider || "unknown",
        reason: "SMS service disabled",
      };
    }

    if (config.sms.provider !== "airtel_iq") {
      throw new Error("Invalid SMS provider");
    }

    // ⚠️ EXACT DLT TEMPLATE TEXT
    const message =
      "{otp} is your OTP to verify your mobile number for login on Fintaraa App/Website. Valid for 1 minute.";

    const response = await sendAirtelIqSMS(to, message, { otp });
    return {
      success: true,
      provider: "airtel_iq",
      response,
    };
  } catch (err: unknown) {
    console.log("Error:", err);
    const errMessage = err instanceof Error ? err.message : "Unknown SMS error";
    const responsePayload =
      axios.isAxiosError(err) && err.response?.data !== undefined
        ? ` response=${safeStringify(err.response.data)}`
        : "";

    logger.error(
      `[SMS] OTP send failed to=${maskedTo} provider=${config.sms?.provider || "unknown"} error=${errMessage}${responsePayload}`,
    );
    throw err instanceof Error ? err : new Error("Failed to send OTP SMS");
  }
}
