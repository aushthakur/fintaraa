import { config } from "../config/config";
import nodemailer, {
  SendMailOptions,
  SentMessageInfo,
  Transporter,
} from "nodemailer";
import { generateOtpTemplate } from "./emailTemplate";
import { getNewsletterUnsubscribeUrl } from "../services/newsletterUnsubscribe.service";

interface EmailPayload {
    to: string;
    otp: string;
    userName?: string;
}

let transporter: Transporter | null = null;

export const getEmailTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: Number(config.email.port),
      secure: config.email.secure === true,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      requireTLS: config.email.secure !== true,
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
    address: config.email.from as string,
  },
  replyTo: config.email.from as string,
  to: receiverEmail,
  subject,
  html: htmlContent,
  attachments: attachments && attachments.length > 0 ? attachments : undefined,
});

export const createNewsletterMailOptions = (
  receiverEmail: string,
  subject: string,
  htmlContent: string,
): SendMailOptions => {
  const unsubscribeUrl = getNewsletterUnsubscribeUrl(receiverEmail);
  const footer = `<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e5edf3;text-align:center;font:12px/1.6 Arial,sans-serif;color:#667085">You are receiving this email from Fintaraa. <a href="${unsubscribeUrl}" style="color:#075cde">Unsubscribe in one click</a>.</div>`;
  const html = /<\/body\s*>/i.test(htmlContent)
    ? htmlContent.replace(/<\/body\s*>/i, `${footer}</body>`)
    : `${htmlContent}${footer}`;
  const textContent = htmlContent
    .replace(/<style[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return {
    ...createDefaultMailOptions(receiverEmail, subject, html),
    text: `${textContent}\n\nUnsubscribe: ${unsubscribeUrl}`,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "List-ID": "Fintaraa Newsletter <newsletter.fintaraa.com>",
      Precedence: "bulk",
      "X-Auto-Response-Suppress": "All",
    },
  };
};

export const sendMail = async (mailOptions: SendMailOptions) =>
  getEmailTransporter().sendMail(mailOptions);

export const verifyEmailTransporter = () => getEmailTransporter().verify();

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
