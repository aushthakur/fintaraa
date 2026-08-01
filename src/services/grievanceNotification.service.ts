import { config } from "../config/config";
import {
  GrievanceStatus,
  type IGrievance,
  type IGrievanceComment,
} from "../modals/grievance.model";
import { CommunicationChannel } from "../modals/communicationOutbox.model";
import { enqueueCommunication } from "./communicationOutbox.service";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const display = (value: unknown) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const paragraphs = (value: unknown) =>
  escapeHtml(value).replace(/\r?\n/g, "<br />");

const emailShell = ({
  heading,
  intro,
  content,
  actionLabel,
  actionUrl,
}: {
  heading: string;
  intro: string;
  content: string;
  actionLabel?: string;
  actionUrl?: string;
}) => `
  <div style="margin:0;background:#f4f7fb;padding:28px 12px;font-family:Arial,sans-serif;color:#142c42">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dce6ef;border-radius:18px;overflow:hidden">
      <div style="background:#075cde;padding:22px 26px;color:#ffffff">
        <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Fintaraa Grievance Desk</div>
        <h1 style="font-size:23px;line-height:1.3;margin:8px 0 0">${escapeHtml(heading)}</h1>
      </div>
      <div style="padding:26px">
        <p style="font-size:14px;line-height:1.7;color:#51697d;margin:0 0 18px">${escapeHtml(intro)}</p>
        ${content}
        ${
          actionLabel && actionUrl
            ? `<p style="margin:24px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#075cde;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-size:13px;font-weight:700">${escapeHtml(actionLabel)}</a></p>`
            : ""
        }
      </div>
    </div>
  </div>
`;

const detailRow = (label: string, value: unknown) => `
  <tr>
    <td style="padding:8px 10px;border-bottom:1px solid #e8eef4;font-size:12px;font-weight:700;color:#52697c;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e8eef4;font-size:13px;color:#142c42">${paragraphs(value || "—")}</td>
  </tr>
`;

const detailsTable = (rows: string) =>
  `<table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e1e9f0;border-radius:12px;overflow:hidden">${rows}</table>`;

const trackUrl = (ticketNumber: string) =>
  `${String(config.publicWebsiteUrl || "https://fintaraa.com").replace(/\/+$/, "")}/grievance?ticket=${encodeURIComponent(ticketNumber)}`;

const adminUrl = (ticketNumber: string) =>
  `${String(process.env.ADMIN_PANEL_URL || config.frontendUrl || "http://localhost:3000").replace(/\/+$/, "")}/dashboard/grievances?ticket=${encodeURIComponent(ticketNumber)}`;

const queueEmail = ({
  to,
  subject,
  html,
  eventName,
  grievance,
  suffix,
}: {
  to: string;
  subject: string;
  html: string;
  eventName: string;
  grievance: IGrievance;
  suffix: string;
}) =>
  enqueueCommunication({
    channel: CommunicationChannel.EMAIL,
    eventName,
    referenceId: grievance.ticketNumber,
    recipient: to,
    idempotencyKey: `grievance:${String(grievance._id)}:${suffix}:email:${to.toLowerCase()}`,
    payload: { to, subject, html },
  });

export const queueGrievanceCreatedNotifications = async (
  grievance: IGrievance,
) => {
  const customerHtml = emailShell({
    heading: `We received grievance ${grievance.ticketNumber}`,
    intro: `Hello ${grievance.fullName}, your complaint has been registered and will be reviewed by our grievance team.`,
    content: detailsTable(
      detailRow("Ticket number", grievance.ticketNumber) +
        detailRow("Status", display(grievance.status)) +
        detailRow("Nature", display(grievance.nature)) +
        detailRow("Application ID", grievance.applicationId) +
        detailRow(
          "SLA due date",
          grievance.slaDueAt.toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
          }),
        ),
    ),
    actionLabel: "Track your complaint",
    actionUrl: trackUrl(grievance.ticketNumber),
  });

  const internalHtml = emailShell({
    heading: `New grievance ${grievance.ticketNumber}`,
    intro: "A new grievance has been submitted and is waiting in the admin queue.",
    content:
      detailsTable(
        detailRow("Customer", grievance.fullName) +
          detailRow("Mobile", grievance.mobile) +
          detailRow("Email", grievance.email) +
          detailRow("Application ID", grievance.applicationId) +
          detailRow("Nature", display(grievance.nature)) +
          detailRow("Description", grievance.description),
      ) +
      `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#8a3a16"><strong>SLA:</strong> Resolve within 7 business days.</p>`,
    actionLabel: "Open grievance in Admin",
    actionUrl: adminUrl(grievance.ticketNumber),
  });

  const customer = queueEmail({
    to: grievance.email,
    subject: `Grievance ${grievance.ticketNumber} received | Fintaraa`,
    html: customerHtml,
    eventName: "grievance_created_customer",
    grievance,
    suffix: "created-customer",
  });
  const internal = config.grievance.notificationEmails.map((email, index) =>
    queueEmail({
      to: email,
      subject: `[New Grievance] ${grievance.ticketNumber} — ${display(grievance.nature)}`,
      html: internalHtml,
      eventName: "grievance_created_internal",
      grievance,
      suffix: `created-internal-${index}`,
    }),
  );
  await Promise.all([customer, ...internal]);
};

export const queueGrievanceStatusNotification = async ({
  grievance,
  eventKey,
}: {
  grievance: IGrievance;
  eventKey: string;
}) => {
  const status = display(grievance.status);
  const html = emailShell({
    heading: `Grievance status updated to ${status}`,
    intro: `Hello ${grievance.fullName}, there is an update on grievance ${grievance.ticketNumber}.`,
    content: detailsTable(
      detailRow("Ticket number", grievance.ticketNumber) +
        detailRow("Current status", status) +
        detailRow("Resolution note", grievance.resolutionNote),
    ),
    actionLabel: "View complaint tracker",
    actionUrl: trackUrl(grievance.ticketNumber),
  });
  const jobs: Promise<unknown>[] = [
    queueEmail({
      to: grievance.email,
      subject: `${grievance.ticketNumber} status: ${status} | Fintaraa`,
      html,
      eventName: "grievance_status_changed",
      grievance,
      suffix: `status-${eventKey}`,
    }),
  ];

  if (
    grievance.mobile &&
    config.grievance.smsStatusTemplateId &&
    config.grievance.smsStatusMessage
  ) {
    jobs.push(
      enqueueCommunication({
        channel: CommunicationChannel.SMS,
        eventName: "grievance_status_changed",
        referenceId: grievance.ticketNumber,
        recipient: grievance.mobile,
        idempotencyKey: `grievance:${String(grievance._id)}:status-${eventKey}:sms`,
        payload: {
          to: grievance.mobile,
          message: config.grievance.smsStatusMessage,
          templateId: config.grievance.smsStatusTemplateId,
          variables: {
            ticket: grievance.ticketNumber,
            status,
          },
        },
      }),
    );
  }
  await Promise.all(jobs);
};

export const queueGrievanceCommentNotification = async ({
  grievance,
  comment,
}: {
  grievance: IGrievance;
  comment: IGrievanceComment;
}) => {
  const html = emailShell({
    heading: `New response on ${grievance.ticketNumber}`,
    intro: `Hello ${grievance.fullName}, the Fintaraa grievance team has added a response to your complaint.`,
    content:
      `<div style="border-left:4px solid #075cde;background:#f5f8fc;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.7;color:#253f55">${paragraphs(comment.message)}</div>` +
      `<p style="margin:16px 0 0;font-size:12px;color:#60788b">Current status: <strong>${escapeHtml(display(grievance.status))}</strong></p>`,
    actionLabel: "View complete complaint",
    actionUrl: trackUrl(grievance.ticketNumber),
  });
  await queueEmail({
    to: grievance.email,
    subject: `New update on grievance ${grievance.ticketNumber} | Fintaraa`,
    html,
    eventName: "grievance_admin_comment",
    grievance,
    suffix: `comment-${String(comment._id || comment.createdAt.getTime())}`,
  });
};

export const isTerminalGrievanceStatus = (status: GrievanceStatus) =>
  status === GrievanceStatus.RESOLVED;
