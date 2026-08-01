import mongoose, { Document, Schema } from "mongoose";

export enum CommunicationChannel {
  EMAIL = "email",
  SMS = "sms",
  WHATSAPP = "whatsapp",
}

export enum CommunicationOutboxStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  SENT = "sent",
  DELIVERED = "delivered",
  READ = "read",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export interface ICommunicationOutbox extends Document {
  channel: CommunicationChannel;
  eventName: string;
  referenceId?: string;
  recipient: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  status: CommunicationOutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  providerMessageId?: string;
  providerStatus?: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CommunicationOutboxSchema = new Schema<ICommunicationOutbox>(
  {
    channel: {
      type: String,
      enum: Object.values(CommunicationChannel),
      required: true,
    },
    eventName: { type: String, required: true, trim: true },
    referenceId: { type: String, trim: true },
    recipient: { type: String, required: true, trim: true },
    payload: { type: Schema.Types.Mixed, required: true },
    idempotencyKey: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(CommunicationOutboxStatus),
      default: CommunicationOutboxStatus.PENDING,
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 4, min: 1 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedAt: { type: Date },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    providerMessageId: { type: String, trim: true },
    providerStatus: { type: String, trim: true },
    lastError: { type: String, trim: true },
  },
  { timestamps: true },
);

CommunicationOutboxSchema.index({ idempotencyKey: 1 }, { unique: true });
CommunicationOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
CommunicationOutboxSchema.index({ referenceId: 1, createdAt: -1 });
CommunicationOutboxSchema.index({ channel: 1, createdAt: -1 });

export const CommunicationOutbox =
  mongoose.models.CommunicationOutbox ||
  mongoose.model<ICommunicationOutbox>(
    "CommunicationOutbox",
    CommunicationOutboxSchema,
  );
