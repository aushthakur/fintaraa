import axios from "axios";
import { config } from "../config/config";

/**
 * Replaces variables in message template with actual values
 * Example: "Your OTP is {var}" with variables = {var: "123456"} => "Your OTP is 123456"
 */
const replaceVariables = (
  message: string,
  variables?: Record<string, string | number>
): string => {
  if (!variables || Object.keys(variables).length === 0) {
    return message;
  }

  let processedMessage = message;
  Object.entries(variables).forEach(([key, value]) => {
    // Replace {var}, {{var}}, {VAR}, etc.
    const regex = new RegExp(`\\{\\{?${key}\\}?\\}`, "gi");
    processedMessage = processedMessage.replace(regex, String(value));
  });

  return processedMessage;
};

/**
 * Builds Airtel IQ SMS payload according to official API structure
 */
const buildAirtelPayload = (
  to: string,
  message: string,
  variables?: Record<string, string | number>
) => {
  const airtelConfig = config.sms?.airtelIq;
  if (!airtelConfig) {
    throw new Error("Airtel IQ configuration is missing.");
  }

  // Replace variables in message template
  const processedMessage = replaceVariables(message, variables);

  // Clean phone number - remove + and country code if needed
  const cleanedPhone = to.replace(/^\+?91/, "").replace(/\D/g, "");

  // Build payload according to Airtel IQ API structure
  const payload: any = {
    customerId: airtelConfig.customerId,
    destinationAddress: cleanedPhone,
    message: processedMessage.trim().slice(0, 500),
    messageType: airtelConfig.messageType || "PROMOTIONAL",
    filterBlacklistNumbers: false,
    priority: false,
  };

  // Add optional fields if configured
  if (airtelConfig.senderId) {
    payload.sourceAddress = airtelConfig.senderId;
  }

  if (airtelConfig.entityId) {
    payload.entityId = airtelConfig.entityId;
  }

  if (airtelConfig.templateId) {
    payload.dltTemplateId = airtelConfig.templateId;
  }

  // Add metadata if needed
  if (airtelConfig.extraFields) {
    try {
      const metadata = JSON.parse(airtelConfig.extraFields);
      payload.metaData = metadata;
    } catch {
      payload.metaData = {};
    }
  } else {
    payload.metaData = {};
  }

  return payload;
};

/**
 * Sends SMS via Airtel IQ API
 */
const sendAirtelIqSMS = async (
  to: string,
  message: string,
  variables?: Record<string, string | number>
) => {
  const airtelConfig = config.sms?.airtelIq;

  // Validate configuration
  if (!airtelConfig?.baseUrl) {
    throw new Error("Airtel IQ base URL is not configured.");
  }

  if (!airtelConfig.customerId) {
    throw new Error("Airtel IQ customerId is not configured.");
  }

  if (!to || !message) {
    throw new Error("Missing recipient phone number or message content.");
  }

  // Build payload
  const payload = buildAirtelPayload(to, message, variables);

  // Construct full URL
  const url = airtelConfig.baseUrl.replace(/\/$/, "");

  // Send SMS
  const response = await axios.post(url, payload, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    timeout: 10000,
  });

  // Log in development
  if (config.env === "development") {
    console.log("✅ Airtel IQ SMS sent:", {
      to: payload.destinationAddress,
      message: payload.message,
      status: response.status,
      response: response.data,
    });
  }

  return response.data;
};

/**
 * Sends an SMS using Airtel IQ with robust validation and error handling.
 * @param to - Recipient phone number (e.g., +91XXXXXXXXXX or 10-digit number)
 * @param message - Message content or template with {variables}
 * @param variables - Optional object with variable replacements {var: "value"}
 *
 * @example
 * // Simple message
 * await sendSMS({ to: "+919876543210", message: "Hello World" });
 *
 * // With variables
 * await sendSMS({
 *   to: "+919876543210",
 *   message: "Your OTP is {otp}. Valid for {minutes} minutes.",
 *   variables: { otp: "123456", minutes: "10" }
 * });
 */
export async function sendSMS({
  to,
  message,
  variables,
}: {
  to: string;
  message: string;
  variables?: Record<string, string | number>;
}) {
  try {
    if (!to || !message) {
      throw new Error("Missing recipient phone number or message content.");
    }

    if (!config.sms?.enabled) {
      console.log("⚠️ SMS service is disabled in configuration");
      return { success: false, message: "SMS service is disabled" };
    }

    if (config.sms?.provider !== "airtel_iq") {
      throw new Error("Unsupported SMS provider configured.");
    }

    return await sendAirtelIqSMS(to, message, variables);
  } catch (err: any) {
    const errorLog = {
      code: err?.code || "UNKNOWN",
      message: err?.message || "SMS Error",
      response: err?.response?.data || "No response data",
    };
    console.log("❌ SMS Send Error:", errorLog);
    throw new Error(
      err?.message ||
        "Something went wrong while sending SMS. Please try again later."
    );
  }
}
