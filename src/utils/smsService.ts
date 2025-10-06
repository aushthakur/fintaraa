import twilio from "twilio";
import { config } from "../config/config";

const sid = config.sms?.twilio?.sid;
const authToken = config.sms?.twilio?.authToken;
const fromPhone = config.sms?.twilio?.phoneNumber;

const client = twilio(sid, authToken);

/**
 * Sends an SMS using Twilio with robust validation and error handling.
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
        if (!sid || !authToken || !fromPhone) {
            throw new Error("Twilio credentials are not properly configured.");
        }

        if (!to || !message) {
            throw new Error("Missing recipient phone number or message content.");
        }

        // Sanitize and limit message
        const sanitizedMessage = message.trim().slice(0, 500); // Twilio limit is 1600, keeping 500 for safety

        const response = await client.messages.create({
            body: sanitizedMessage,
            from: fromPhone,
            to,
        });

        if (response.status === "failed" || response.errorCode) {
            throw new Error(
                `Twilio failed: ${response.errorMessage || "Unknown reason"} (Code: ${response.errorCode || "N/A"
                })`
            );
        }

        if (config.env === "development") {
            console.log("✅ SMS sent:", {
                to,
                message: sanitizedMessage,
                status: response.status,
                sid: response.sid,
                timestamp: response.dateCreated,
            });
        }

        return response;
    } catch (err: any) {
        const knownTwilioError = err?.code && err?.message;

        const errorLog = {
            code: err?.code || "UNKNOWN",
            message: err?.message || "Twilio SMS Error",
            moreInfo: err?.moreInfo || "No additional info",
        };
        console.log("❌ SMS Send Error:", errorLog);
        throw new Error(
            knownTwilioError
                ? `SMS sending failed [${errorLog.code}]: ${errorLog.message}`
                : "Something went wrong while sending SMS. Please try again later."
        );
    }
}
