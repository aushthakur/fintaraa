import mongoose, { Document, Schema, Types } from "mongoose";
import { UserType } from "./notification.model";

export enum PushCampaignTarget {
  B2C_APP = "b2c_app",
  B2B_APP = "b2b_app",
  WEBSITE = "website",
}

export enum PushCampaignStatus {
  SCHEDULED = "scheduled",
  PROCESSING = "processing",
  COMPLETED = "completed",
  COMPLETED_WITH_ERRORS = "completed_with_errors",
  CANCELLED = "cancelled",
}

export enum PushDeliveryStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  SENT = "sent",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export interface IPushCampaign extends Document {
  title: string;
  message: string;
  type: string;
  targets: PushCampaignTarget[];
  actionUrl?: string;
  scheduledAt: Date;
  status: PushCampaignStatus;
  createdBy: Types.ObjectId;
  totalRecipients: number;
  pendingCount: number;
  processingCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPushDelivery extends Document {
  campaign: Types.ObjectId;
  recipient: Types.ObjectId;
  recipientRole: UserType;
  targets: PushCampaignTarget[];
  deliveredTargets: PushCampaignTarget[];
  status: PushDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedAt?: Date;
  sentAt?: Date;
  lastError?: string;
  providerSummary?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const PushCampaignSchema = new Schema<IPushCampaign>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    type: {
      type: String,
      required: true,
      trim: true,
      default: "admin-broadcast",
    },
    targets: {
      type: [{ type: String, enum: Object.values(PushCampaignTarget) }],
      required: true,
    },
    actionUrl: { type: String, trim: true, maxlength: 1000 },
    scheduledAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(PushCampaignStatus),
      default: PushCampaignStatus.SCHEDULED,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    totalRecipients: { type: Number, default: 0, min: 0 },
    pendingCount: { type: Number, default: 0, min: 0 },
    processingCount: { type: Number, default: 0, min: 0 },
    sentCount: { type: Number, default: 0, min: 0 },
    failedCount: { type: Number, default: 0, min: 0 },
    cancelledCount: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

PushCampaignSchema.index({ status: 1, scheduledAt: 1, createdAt: 1 });

const PushDeliverySchema = new Schema<IPushDelivery>(
  {
    campaign: {
      type: Schema.Types.ObjectId,
      ref: "PushCampaign",
      required: true,
      index: true,
    },
    recipient: { type: Schema.Types.ObjectId, required: true, index: true },
    recipientRole: {
      type: String,
      enum: Object.values(UserType),
      required: true,
    },
    targets: {
      type: [{ type: String, enum: Object.values(PushCampaignTarget) }],
      required: true,
    },
    deliveredTargets: {
      type: [{ type: String, enum: Object.values(PushCampaignTarget) }],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(PushDeliveryStatus),
      default: PushDeliveryStatus.PENDING,
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 4, min: 1 },
    nextAttemptAt: { type: Date, required: true, index: true },
    lockedAt: { type: Date },
    sentAt: { type: Date },
    lastError: { type: String, trim: true, maxlength: 2000 },
    providerSummary: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

PushDeliverySchema.index(
  { campaign: 1, recipient: 1, recipientRole: 1 },
  { unique: true },
);
PushDeliverySchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export const PushCampaign: mongoose.Model<IPushCampaign> =
  mongoose.models.PushCampaign ||
  mongoose.model<IPushCampaign>("PushCampaign", PushCampaignSchema);

export const PushDelivery: mongoose.Model<IPushDelivery> =
  mongoose.models.PushDelivery ||
  mongoose.model<IPushDelivery>("PushDelivery", PushDeliverySchema);
