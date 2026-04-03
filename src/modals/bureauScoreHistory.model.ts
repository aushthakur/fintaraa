import mongoose, { Document, Schema, Types } from "mongoose";

export type BureauScoreName = "cibil" | "experian";
export type BureauScoreLookupSource =
  | "customer_lookup"
  | "self_lookup"
  | "pdf_lookup";

export interface IBureauScoreHistory extends Document {
  ownerId: Types.ObjectId;
  ownerRole: "user" | "agency" | "agency_member";
  ownerName?: string;
  actorId: Types.ObjectId;
  actorRole: "user" | "agency" | "agency_member";
  actorName?: string;
  actorEmail?: string;
  actorMobile?: string;
  bureau: BureauScoreName;
  lookupSource: BureauScoreLookupSource;
  customerName?: string;
  customerMobile?: string;
  customerPan?: string;
  customerGender?: string;
  paidAmount?: number;
  currency?: string;
  paymentStatus?: "verified" | "waived" | "failed" | "pending";
  paymentOrderId?: string;
  paymentId?: string;
  paymentSignature?: string;
  paymentMethod?: string;
  bureauScore?: number;
  cibilScore?: number;
  experianScore?: number;
  pdfUrl?: string;
  report?: Record<string, any>;
  payload?: Record<string, any>;
  response?: Record<string, any>;
  summary?: string;
  note?: string;
  fetchedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BureauScoreHistorySchema = new Schema<IBureauScoreHistory>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    ownerRole: {
      type: String,
      enum: ["user", "agency", "agency_member"],
      required: true,
      index: true,
    },
    ownerName: { type: String, trim: true },
    actorId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["user", "agency", "agency_member"],
      required: true,
      index: true,
    },
    actorName: { type: String, trim: true },
    actorEmail: { type: String, trim: true, lowercase: true },
    actorMobile: { type: String, trim: true },
    bureau: {
      type: String,
      enum: ["cibil", "experian"],
      required: true,
      index: true,
    },
    lookupSource: {
      type: String,
      enum: ["customer_lookup", "self_lookup", "pdf_lookup"],
      default: "customer_lookup",
      index: true,
    },
    customerName: { type: String, trim: true },
    customerMobile: { type: String, trim: true },
    customerPan: { type: String, trim: true, uppercase: true },
    customerGender: { type: String, trim: true },
    paidAmount: { type: Number },
    currency: { type: String, default: "INR" },
    paymentStatus: {
      type: String,
      enum: ["verified", "waived", "failed", "pending"],
      default: "verified",
      index: true,
    },
    paymentOrderId: { type: String, trim: true, index: true },
    paymentId: { type: String, trim: true },
    paymentSignature: { type: String, trim: true },
    paymentMethod: { type: String, trim: true },
    bureauScore: { type: Number },
    cibilScore: { type: Number },
    experianScore: { type: Number },
    pdfUrl: { type: String, trim: true },
    report: { type: Object },
    payload: { type: Object },
    response: { type: Object },
    summary: { type: String },
    note: { type: String },
    fetchedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

BureauScoreHistorySchema.index({ ownerId: 1, fetchedAt: -1 });
BureauScoreHistorySchema.index({ ownerId: 1, actorId: 1, fetchedAt: -1 });
BureauScoreHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const BureauScoreHistory = mongoose.model<IBureauScoreHistory>(
  "BureauScoreHistory",
  BureauScoreHistorySchema
);
