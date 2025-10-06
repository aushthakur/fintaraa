type TemplateContext = Record<string, string | number>;

interface NotificationTemplate {
  title: string | number;
  message: string | number;
}

interface DualNotificationTemplate {
  sender: (ctx?: TemplateContext) => NotificationTemplate;
  receiver: (ctx?: TemplateContext) => NotificationTemplate;
}

function formatStatus(status?: any): any {
  switch (status) {
    case "hired": return "Hired";
    case "applied": return "Applied";
    case "offered": return "Offered";
    case "rejected": return "Rejected";
    case "withdrawn": return "Withdrawn";
    case "shortlisted": return "Shortlisted";
    case "under_review": return "Under Review";
    case "interview": return "Interview Scheduled";
    case "offer_declined": return "Offer Declined";
    case "offer_accepted": return "Offer Accepted";
    default: return status || "Updated";
  }
}

function formatConnectionStatus(status?: any): {
  action: string;
  description: string;
  receiverMessage: string;
} {
  switch (status) {
    case "pending":
      return {
        action: "Request Sent",
        description: "sent a connection request to",
        receiverMessage: "sent you a connection request",
      };
    case "accepted":
      return {
        action: "Accepted",
        description: "accepted the connection request from",
        receiverMessage: "accepted your connection request",
      };
    case "cancelled":
      return {
        action: "Cancelled",
        description: "cancelled the connection request to",
        receiverMessage: "cancelled the connection request",
      };
    case "removed":
      return {
        action: "Removed",
        description: "removed the connection with",
        receiverMessage: "removed the connection with you",
      };
    default:
      return {
        action: "Updated",
        description: "updated the connection status for",
        receiverMessage: "updated the connection status",
      };
  }
}

export const NotificationMessages: Record<
  string,
  DualNotificationTemplate
> = {
  "application-status-update": {
    sender: (ctx) => ({
      title: `Application marked as "${formatStatus(ctx?.status)}"`,
      message: `You updated ${ctx?.userName || "the candidate"}'s application for the job "${ctx?.jobTitle || "Untitled"}" to "${formatStatus(ctx?.status)}".`,
    }),
    receiver: (ctx) => ({
      title: `Update on your application for "${ctx?.jobTitle || "the job"}"`,
      message: `Your application has been updated to "${formatStatus(ctx?.status)}". Stay tuned for further updates.`,
    }),
  },

  "badge-earned": {
    sender: (ctx) => ({
      title: `Badge Assigned: ${ctx?.badgeName}`,
      message: `You have assigned the badge "${ctx?.badgeName}" to ${ctx?.userName}.`,
    }),
    receiver: (ctx) => ({
      title: `You've Earned a Badge! 🎉`,
      message: `You've been awarded the "${ctx?.badgeName}" badge.`,
    }),
  },

  "task-status-update": {
    sender: (ctx) => ({
      title: `Task "${ctx?.taskTitle}" is now "${ctx?.status}"`,
      message: `You've updated the task assigned to ${ctx?.assigneeName} as "${ctx?.status}".`,
    }),
    receiver: (ctx) => ({
      title: `Update on: "${ctx?.taskTitle}"`,
      message: `The task "${ctx?.taskTitle}" assigned to you is now marked as "${ctx?.status}".`,
    }),
  },

  "job-status-update": {
    sender: (ctx) => ({
      title: `Job marked as "${ctx?.status}"`,
      message: `You updated the job "${ctx?.jobTitle || "Untitled"}" to "${ctx?.status}".`,
    }),
    receiver: (ctx) => ({
      title: `Job "${ctx?.jobTitle}" is now "${ctx?.status}"`,
      message:
        ctx?.status === "open"
          ? `The job "${ctx?.jobTitle}" is now open for applications.`
          : ctx?.status === "draft"
            ? `The job "${ctx?.jobTitle}" has been saved as a draft.`
            : ctx?.status === "paused"
              ? `The job "${ctx?.jobTitle}" is currently paused and not accepting new applications.`
              : ctx?.status === "filled"
                ? `The job "${ctx?.jobTitle}" has been filled. Thank you for applying.`
                : ctx?.status === "closed"
                  ? `The job "${ctx?.jobTitle}" has been closed.`
                  : ctx?.status === "expired"
                    ? `The job "${ctx?.jobTitle}" has expired and is no longer available.`
                    : ctx?.status === "rejected"
                      ? `The job "${ctx?.jobTitle}" was rejected during review.`
                      : ctx?.status === "pending-approval"
                        ? `The job "${ctx?.jobTitle}" is pending approval and will be reviewed shortly.`
                        : `The job "${ctx?.jobTitle}" status has been updated.`,
    }),
  },

  "connection-request-update": {
    sender: (ctx) => {
      const formatted = formatConnectionStatus(ctx?.status);
      return {
        title: `Connection ${formatted.action}`,
        message: `You have ${formatted.description} ${ctx?.receiverName || "a user"}.`,
      };
    },
    receiver: (ctx) => {
      const formatted = formatConnectionStatus(ctx?.status);
      return {
        title: `Connection ${formatted.action}`,
        message: `${ctx?.senderName || "Someone"} has ${formatted.receiverMessage} you.`,
      };
    },
  },

  "admin-message": {
    sender: (ctx) => ({
      title: `Message Sent to ${ctx?.userName}`,
      message: `You sent a message to ${ctx?.userName} regarding "${ctx?.topic || "account updates"}".`,
    }),
    receiver: (ctx) => ({
      title: `📬 New Message from Admin`,
      message: `${ctx?.adminName || "Admin"} sent you a message: "${ctx?.message || "Please check your account."}"`,
    }),
  },

  "general-alert": {
    sender: (ctx) => ({
      title: ctx?.title || "System Alert",
      message: ctx?.message || "A global message has been sent.",
    }),
    receiver: (ctx) => ({
      title: ctx?.title || "📢 Alert",
      message: ctx?.message || "You have a new important alert.",
    }),
  },
};
