import { config } from "../config/config";
import nodemailer, { Transporter } from "nodemailer";
import { generateOtpTemplate } from "./emailTemplate";

interface EmailPayload {
    to: string;
    otp: string;
    userName?: string;
}

export async function sendEmail({ to, otp, userName = "User" }: EmailPayload) {
    const senderName = "Notification Service";
    const senderEmail = config.email.user;

    if (!to || !otp) {
        console.log("❌ Email Validation Error: Missing 'to' or 'otp'");
        return;
    }

    let transporter: Transporter;

    try {
        transporter = nodemailer.createTransport({
            host: config.email.host,
            port: Number(config.email.port),
            secure: config.email.secure === true,
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });

        const mailOptions = {
            from: `"${senderName}" <${senderEmail}>`,
            to,
            subject: "Your One-Time Password (OTP)",
            text: `Hello ${userName},\n\nYour OTP is: ${otp}\n\nThis OTP is valid for 10 minutes.`,
            html: generateOtpTemplate(otp, userName),
        };

        const info = await transporter.sendMail(mailOptions);

        if (!info?.messageId) {
            console.log("❌ Email Send Failed: No message ID returned.");
            return;
        }

        if (config.env !== "production")
            console.log("📧 Email sent successfully:", {
                to,
                otp,
                accepted: info.accepted,
                rejected: info.rejected,
                messageId: info.messageId,
            });

        return info;
    } catch (error: any) {
        console.log("❌ Email Send Error", {
            to,
            otp,
            error: error?.message || error,
        });
    }
}
