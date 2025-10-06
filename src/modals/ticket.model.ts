import mongoose, { Schema, model, Document, Types } from "mongoose";

/** 🔖 Priority Tags for Property Listing & Booking System **/

// 🚨 CRITICAL: Blocking issues affecting safety, legality, and platform integrity
export const CRITICAL_PRIORITY_TAGS = [
  "double_booking_detected",
  "payment_gateway_failure",
  "unauthorized_access_reported",
  "host_account_permanently_suspended",
  "property_access_denied",
  "fraudulent_property_detected",
  "legal_notice_received",
  "emergency_situation_reported",
  "criminal_activity_suspected",
  "booking_confirmation_failed",
  "major_security_breach",
  "guest_locked_out",
] as const;

// 🔴 HIGH: Severe operational issues affecting trust, access, and booking reliability
export const HIGH_PRIORITY_TAGS = [
  "property_not_as_listed",
  "checkin_denied_by_host",
  "booking_canceled_last_minute_by_host",
  "urgent_support_required",
  "key_not_provided",
  "host_unreachable_at_checkin",
  "identity_verification_failed",
  "review_fraud_detected",
  "host_policy_violation",
  "false_availability_reported",
  "refund_pending_critical",
  "negative_pr_review_impacting_score",
  "duplicate_property_listing",
] as const;

// 🟠 MEDIUM: Service quality issues, feedback, moderate support requests
export const MEDIUM_PRIORITY_TAGS = [
  "amenities_not_matching_description",
  "checkin_time_conflict",
  "partial_refund_requested",
  "cleanliness_issue_reported",
  "host_response_delay",
  "guest_inquiry_unanswered",
  "property_images_misleading",
  "date_change_requested",
  "support_ticket_raised_by_host",
  "listing_pending_manual_approval",
  "cancellation_policy_confusion",
  "inconsistent_pricing_reported",
  "guest_complaint_recorded",
] as const;

// 🟡 LOW: Informational updates, feature requests, minor actions
export const LOW_PRIORITY_TAGS = [
  "successful_booking",
  "profile_updated",
  "host_updated_listing",
  "positive_guest_review",
  "discount_applied",
  "promotion_request",
  "guest_withdrew_booking",
  "wishlist_item_added",
  "faq_request_received",
  "guest_account_verified",
  "casual_feedback",
  "help_center_viewed",
  "notification_settings_updated",
  "feature_suggestion",
] as const;

// 🔵 SYSTEM: Background logs, syncs, or low-priority tech events
export const SYSTEM_PRIORITY_TAGS = [
  "cron_sync_successful",
  "cache_cleared",
  "property_auto_unpublished",
  "image_uploaded_successfully",
  "system_health_check_passed",
  "email_bounced",
  "sms_failed_to_send",
  "webhook_event_logged",
  "api_call_throttled",
] as const;

// 🟣 ESCALATED: Any ticket manually escalated to upper-tier support
export const ESCALATED_TAGS = [
  "manually_escalated_to_level_2",
  "escalated_to_compliance_team",
  "escalated_to_legal",
  "escalated_due_to_negative_review",
  "vip_guest_support_escalated",
] as const;

/** Enums */
type Priority = "low" | "medium" | "high" | "critical";
type Status =
  | "open"
  | "closed"
  | "on_hold"
  | "resolved"
  | "in_progress"
  | "re_assigned";
type ActionType = "commented" | "status_changed" | "resolved";
type UserType = "User" | "Agent";
type Tag =
  | (typeof HIGH_PRIORITY_TAGS)[number]
  | (typeof MEDIUM_PRIORITY_TAGS)[number]
  | (typeof LOW_PRIORITY_TAGS)[number]
  | (typeof CRITICAL_PRIORITY_TAGS)[number];

/** Interfaces */
interface IInteraction {
  content?: string;
  timestamp?: Date;
  action: ActionType;
  receiverType: UserType;
  initiatorType: UserType;
  receiver: Types.ObjectId;
  initiator: Types.ObjectId;
}

export interface ITicket extends Document {
  tags: Tag[];
  title: string;
  status: Status;
  dueDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  priority: Priority;
  interactions: any[];
  description: string;
  resolutionDate?: Date;
  requester: Types.ObjectId;
  assignee?: Types.ObjectId;
  timeToResolve?: number | null;
  relatedTickets?: Types.ObjectId[];
}

/** Subdocument Schema */
const InteractionSchema = new Schema<IInteraction>(
  {
    initiator: {
      type: Schema.Types.ObjectId,
      refPath: "initiatorType",
      required: true,
    },
    receiver: {
      type: Schema.Types.ObjectId,
      refPath: "receiverType",
      required: true,
    },
    initiatorType: {
      type: String,
      enum: ["User", "Agent"],
      required: true,
    },
    receiverType: {
      type: String,
      enum: ["User", "Agent"],
      required: true,
    },
    action: {
      type: String,
      enum: ["commented", "status_changed", "resolved"],
      required: true,
    },
    content: {
      type: String,
      required: function (this: IInteraction) {
        return this.action === "commented";
      },
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/** Main Ticket Schema */
const TicketSchema = new Schema<ITicket>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    requester: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignee: { type: Schema.Types.ObjectId, ref: "Agent" },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low",
      required: true,
    },
    status: {
      type: String,
      enum: [
        "open",
        "closed",
        "on_hold",
        "resolved",
        "in_progress",
        "re_assigned",
      ],
      default: "open",
      required: true,
    },
    tags: [
      {
        type: String,
        enum: [
          ...HIGH_PRIORITY_TAGS,
          ...MEDIUM_PRIORITY_TAGS,
          ...LOW_PRIORITY_TAGS,
          ...CRITICAL_PRIORITY_TAGS,
        ],
        trim: true,
      },
    ],
    dueDate: { type: Date },
    resolutionDate: { type: Date },
    interactions: [InteractionSchema],
    relatedTickets: [{ type: Schema.Types.ObjectId, ref: "Ticket" }],
  },
  { timestamps: true }
);

/** Virtual Field */
TicketSchema.virtual("timeToResolve").get(function (this: ITicket) {
  return this.resolutionDate && this.createdAt
    ? Math.abs(this.resolutionDate.getTime() - this.createdAt.getTime())
    : null;
});

// Basic filters & access
TicketSchema.index({ requester: 1 }); // Fetch tickets by user
TicketSchema.index({ assignee: 1 }); // Fetch tickets assigned to an agent
TicketSchema.index({ status: 1 }); // Filter by status
TicketSchema.index({ priority: 1 }); // Filter by priority
TicketSchema.index({ tags: 1 }); // Filter/search by tag
TicketSchema.index({ dueDate: 1 }); // Find overdue or due-soon tickets
TicketSchema.index({ resolutionDate: 1 }); // For SLA/metrics
TicketSchema.index({ createdAt: -1 }); // Sorting or recent tickets

// Compound indexes (frequently queried together)
TicketSchema.index({ assignee: 1, status: 1 });
TicketSchema.index({ requester: 1, createdAt: -1 });

/** Export Model */
const Ticket = model<ITicket>("Ticket", TicketSchema);
export default Ticket;
