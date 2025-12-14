import { Document, Schema, Types, model } from "mongoose";

export interface IConsentEvent extends Document {
  user: Types.ObjectId;
  type: "cibil" | "kyc" | "bank_statement" | "identity" | "other";
  partner?: string;
  purpose?: string;
  scope?: string[];
  channel?: "app" | "web" | "agent" | "api";
  referenceId?: string;
  status?: "granted" | "revoked" | "expired" | "denied";
  collectedAt: Date;
  expiresAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ConsentHistorySchema = new Schema<IConsentEvent>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["cibil", "kyc", "bank_statement", "identity", "other"],
      required: true,
    },
    partner: { type: String, trim: true },
    purpose: { type: String, trim: true },
    scope: { type: [String], default: [] },
    channel: { type: String, enum: ["app", "web", "agent", "api"], default: "app" },
    referenceId: { type: String, trim: true },
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

export const ConsentHistory = model<IConsentEvent>(
  "ConsentHistory",
  ConsentHistorySchema
);
