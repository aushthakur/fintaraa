import { config } from "../config/config";
import nodemailer, {
  SendMailOptions,
  SentMessageInfo,
  Transporter,
} from "nodemailer";
import { generateOtpTemplate } from "./emailTemplate";

interface EmailPayload {
    to: string;
    otp: string;
    userName?: string;
}

let transporter: Transporter | null = null;

export const getEmailTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      host: config.email.host,
      port: Number(config.email.port),
      secure: config.email.secure === true,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }

  return transporter;
};

export const createDefaultMailOptions = (
  receiverEmail: string,
  subject: string,
  htmlContent: string,
  attachments?: SendMailOptions["attachments"],
): SendMailOptions => ({
  from: {
    name: "Fintaraa",
    address: config.email.user as string,
  },
  to: receiverEmail,
  subject,
  html: htmlContent,
  attachments: attachments && attachments.length > 0 ? attachments : undefined,
});

export const sendMail = async (mailOptions: SendMailOptions) => {
  return getEmailTransporter().sendMail(mailOptions);
};

export async function sendEmail({ to, otp, userName = "User" }: EmailPayload) {
  const senderName = "Notification Service";
  const senderEmail = config.email.user;

  if (!to || !otp) {
    console.log("❌ Email Validation Error: Missing 'to' or 'otp'");
    return;
  }

  try {
    const mailOptions = {
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject: "Your One-Time Password (OTP)",
      text: `Hello ${userName},\n\nYour OTP is: ${otp}\n\nThis OTP is valid for 10 minutes.`,
      html: generateOtpTemplate(otp, userName),
    };

    const info = await sendMail(mailOptions);

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
