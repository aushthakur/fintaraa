import { SendMailOptions } from "nodemailer";
import {
  createDefaultMailOptions,
  getEmailTransporter,
  sendMail,
} from "../utils/emailService";

const transporter = getEmailTransporter();

const createMailOptions = (
  receiverEmail: string | string[],
  subject: string,
  htmlContent: string,
  attachments?: SendMailOptions["attachments"],
  cc?: string | string[],
): SendMailOptions =>
  createDefaultMailOptions(
    receiverEmail,
    subject,
    htmlContent,
    attachments,
    cc,
  );

const sendEmail = (
  receiverEmail: string,
  subject: string,
  htmlContent: string,
  attachments?: SendMailOptions["attachments"],
): void => {
  const mailOptions = createMailOptions(
    receiverEmail,
    subject,
    htmlContent,
    attachments,
  );

  sendMail(mailOptions).catch((error: any) => {
    console.log("Error while sending email:", error);
  });
};

export { transporter, createMailOptions, sendEmail };
