import mongoose, { Schema, model, Document, Types } from "mongoose";

/** 🔖 Priority Tags for OLX-like Marketplace with Barter System & Social Features **/

// 🚨 CRITICAL: Blocking issues affecting safety, legality, and platform integrity
export const CRITICAL_PRIORITY_TAGS = [
  "payment_gateway_failure",
  "unauthorized_access_reported",
  "seller_account_permanently_suspended",
  "buyer_account_permanently_suspended",
  "fraudulent_listing_detected",
  "scam_reported",
  "legal_notice_received",
  "emergency_situation_reported",
  "criminal_activity_suspected",
  "stolen_goods_reported",
  "transaction_dispute_escalated",
  "major_security_breach",
  "counterfeit_product_detected",
  "identity_theft_suspected",
  "meetup_safety_incident",
  "financial_fraud_detected",
] as const;

// 🔴 HIGH: Severe operational issues affecting trust, access, and transaction reliability
export const HIGH_PRIORITY_TAGS = [
  "product_not_as_described",
  "seller_not_responding",
  "buyer_not_showing_up",
  "barter_deal_breach",
  "payment_not_received",
  "item_damaged_on_delivery",
  "fake_product_complaint",
  "urgent_support_required",
  "seller_unreachable_after_payment",
  "harassment_reported",
  "abusive_chat_conversation",
  "account_hacked_reported",
  "review_fraud_detected",
  "price_manipulation_detected",
  "duplicate_listing_violation",
  "negative_feedback_impacting_rating",
  "refund_request_critical",
  "meetup_location_unsafe",
  "aggressive_seller_behavior",
  "barter_item_not_delivered",
  "following_abuse_stalking",
] as const;

// 🟠 MEDIUM: Service quality issues, feedback, moderate support requests
export const MEDIUM_PRIORITY_TAGS = [
  "product_condition_mismatch",
  "price_negotiation_dispute",
  "meetup_time_conflict",
  "partial_refund_requested",
  "item_cleanliness_issue",
  "seller_response_delay",
  "buyer_inquiry_unanswered",
  "product_images_misleading",
  "delivery_date_change_requested",
  "listing_pending_manual_approval",
  "chat_conversation_flagged",
  "inappropriate_product_description",
  "inconsistent_pricing_reported",
  "buyer_complaint_recorded",
  "seller_complaint_recorded",
  "barter_valuation_disagreement",
  "exchange_terms_unclear",
  "profile_verification_pending",
  "follower_count_manipulation_suspected",
  "spam_messages_reported",
  "excessive_follow_requests",
  "blocked_user_attempting_contact",
] as const;

// 🟡 LOW: Informational updates, feature requests, minor actions
export const LOW_PRIORITY_TAGS = [
  "app_support",
  "callback_request",
  "successful_sale",
  "successful_purchase",
  "successful_barter_exchange",
  "profile_updated",
  "seller_updated_listing",
  "positive_buyer_review",
  "positive_seller_review",
  "discount_offered",
  "promotion_request",
  "buyer_withdrew_offer",
  "seller_rejected_offer",
  "wishlist_item_added",
  "product_marked_as_sold",
  "faq_request_received",
  "user_account_verified",
  "casual_feedback",
  "help_center_viewed",
  "notification_settings_updated",
  "feature_suggestion",
  "new_follower_added",
  "user_unfollowed",
  "listing_shared",
  "chat_initiated",
  "offer_made",
  "counter_offer_sent",
  "barter_proposal_sent",
  "location_preference_updated",
] as const;

// 🔵 SYSTEM: Background logs, syncs, or low-priority tech events
export const SYSTEM_PRIORITY_TAGS = [
  "cron_sync_successful",
  "cache_cleared",
  "listing_auto_expired",
  "listing_auto_renewed",
  "image_uploaded_successfully",
  "system_health_check_passed",
  "email_bounced",
  "sms_failed_to_send",
  "push_notification_sent",
  "webhook_event_logged",
  "api_call_throttled",
  "search_index_updated",
  "category_sync_completed",
  "user_session_expired",
  "inactive_listing_archived",
  "follow_notification_sent",
] as const;

// 🟣 ESCALATED: Any ticket manually escalated to upper-tier support
export const ESCALATED_TAGS = [
  "manually_escalated_to_level_2",
  "escalated_to_compliance_team",
  "escalated_to_legal",
  "escalated_due_to_negative_review",
  "vip_user_support_escalated",
  "repeated_violation_escalated",
  "trust_and_safety_review",
  "media_attention_escalated",
  "high_value_transaction_dispute",
] as const;

// 🟢 BARTER SPECIFIC: Tags specific to barter/exchange transactions
export const BARTER_SPECIFIC_TAGS = [
  "barter_request_received",
  "barter_request_accepted",
  "barter_request_rejected",
  "barter_exchange_completed",
  "barter_item_condition_dispute",
  "barter_value_mismatch",
  "barter_exchange_cancelled",
  "barter_terms_violated",
  "multi_item_barter_proposed",
  "cash_plus_barter_deal",
] as const;

// 💬 CHAT & SOCIAL: Tags related to messaging and social features
export const CHAT_SOCIAL_TAGS = [
  "chat_message_flagged",
  "inappropriate_language_in_chat",
  "spam_messages_in_chat",
  "seller_chat_blocked",
  "buyer_chat_blocked",
  "follow_request_sent",
  "follow_request_accepted",
  "follower_removed",
  "user_blocked",
  "user_unblocked",
  "profile_view_tracked",
  "seller_store_visited",
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
type UserType = "User" | "Agent" | "Agency" | "Admin";
type Tag =
  | (typeof HIGH_PRIORITY_TAGS)[number]
  | (typeof MEDIUM_PRIORITY_TAGS)[number]
  | (typeof LOW_PRIORITY_TAGS)[number]
  | (typeof CRITICAL_PRIORITY_TAGS)[number]
  | (typeof SYSTEM_PRIORITY_TAGS)[number]
  | (typeof ESCALATED_TAGS)[number]
  | (typeof BARTER_SPECIFIC_TAGS)[number]
  | (typeof CHAT_SOCIAL_TAGS)[number];

/** Interfaces */
interface IAttachment {
  url: string;
  type?: string;
  name?: string;
  size?: number;
  mimetype?: string;
}

interface IInteraction {
  content?: string;
  timestamp?: Date;
  action: ActionType;
  receiverType: UserType;
  initiatorType: UserType;
  receiver: Types.ObjectId;
  initiator: Types.ObjectId;
  attachments?: IAttachment[];
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
  requesterRole: UserType;
  assignee?: Types.ObjectId;
  timeToResolve?: number | null;
  relatedTickets?: Types.ObjectId[];
  listingId?: Types.ObjectId; // Reference to the product listing
  transactionId?: Types.ObjectId; // Reference to transaction/barter deal
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
      enum: ["User", "Agent", "Agency", "Admin"],
      required: true,
    },
    receiverType: {
      type: String,
      enum: ["User", "Agent", "Agency", "Admin"],
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
        return (
          this.action === "commented" &&
          (!this.attachments || this.attachments.length === 0)
        );
      },
    },
    attachments: [
      {
        url: { type: String },
        type: { type: String },
        name: { type: String },
        size: { type: Number },
        mimetype: { type: String },
      },
    ],
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

/** Main Ticket Schema */
const TicketSchema = new Schema<ITicket>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    requester: {
      type: Schema.Types.ObjectId,
      refPath: "requesterRole",
      required: true,
    },
    requesterRole: {
      type: String,
      enum: ["User", "Agency"],
      default: "User",
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
          ...SYSTEM_PRIORITY_TAGS,
          ...ESCALATED_TAGS,
          ...BARTER_SPECIFIC_TAGS,
          ...CHAT_SOCIAL_TAGS,
        ],
        trim: true,
      },
    ],
    dueDate: { type: Date },
    resolutionDate: { type: Date },
    interactions: [InteractionSchema],
    relatedTickets: [{ type: Schema.Types.ObjectId, ref: "Ticket" }],
    listingId: { type: Schema.Types.ObjectId, ref: "Product" },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction" },
  },
  { timestamps: true },
);

/** Virtual Field */
TicketSchema.virtual("timeToResolve").get(function (this: ITicket) {
  return this.resolutionDate && this.createdAt
    ? Math.abs(this.resolutionDate.getTime() - this.createdAt.getTime())
    : null;
});

// Basic filters & access
TicketSchema.index({ requester: 1 });
TicketSchema.index({ assignee: 1 });
TicketSchema.index({ status: 1 });
TicketSchema.index({ priority: 1 });
TicketSchema.index({ tags: 1 });
TicketSchema.index({ dueDate: 1 });
TicketSchema.index({ resolutionDate: 1 });
TicketSchema.index({ createdAt: -1 });
TicketSchema.index({ listingId: 1 });
TicketSchema.index({ transactionId: 1 });

// Compound indexes
TicketSchema.index({ assignee: 1, status: 1 });
TicketSchema.index({ requester: 1, createdAt: -1 });
TicketSchema.index({ tags: 1, priority: 1 });

/** Export Model */
const Ticket = model<ITicket>("Ticket", TicketSchema);
export default Ticket;
