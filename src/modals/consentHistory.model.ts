import { Document, Schema, Types, model } from "mongoose";

export interface IConsentEvent extends Document {
  user: Types.ObjectId;
  actorModel: "User" | "Agency";
  actorRole?: string;
  type: "cibil" | "kyc" | "bank_statement" | "identity" | "other";
  partner?: string;
  purpose?: string;
  scope?: string[];
  channel?: "app" | "web" | "agent" | "api";
  referenceId?: string;
  status?: "granted" | "revoked" | "expired" | "denied";
  expiresAt?: Date;
  collectedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ConsentHistorySchema = new Schema<IConsentEvent>(
  {
    user: {
      type: Schema.Types.ObjectId,
      refPath: "actorModel",
      required: true,
      index: true,
    },
    actorModel: {
      type: String,
      enum: ["User", "Agency"],
      default: "User",
      required: true,
    },
    actorRole: { type: String, trim: true },
    type: {
      type: String,
      enum: ["cibil", "kyc", "bank_statement", "identity", "other"],
      required: true,
    },
    partner: { type: String, trim: true },
    purpose: { type: String, trim: true },
    scope: { type: [String], default: [] },
    referenceId: { type: String, trim: true },
    channel: {
      type: String,
      enum: ["app", "web", "agent", "api"],
      default: "app",
    },
    status: {
      type: String,
      enum: ["granted", "revoked", "expired", "denied"],
      default: "granted",
    },
    collectedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    metadata: { type: Object },
  },
  { timestamps: true }
);

ConsentHistorySchema.index({ user: 1, collectedAt: -1 });
ConsentHistorySchema.index(
  { user: 1, actorModel: 1, purpose: 1, referenceId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      actorModel: { $exists: true },
      referenceId: { $exists: true },
      purpose: { $exists: true },
    },
  },
);

export const ConsentHistory = model<IConsentEvent>(
  "ConsentHistory",
  ConsentHistorySchema
);
