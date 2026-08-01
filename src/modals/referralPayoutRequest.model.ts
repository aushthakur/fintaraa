import mongoose, { Document, Schema, Types } from "mongoose";

export type ReferralPayoutRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paid";

export const MINIMUM_REFERRAL_PAYOUT_AMOUNT = 500;
export const MAXIMUM_REFERRAL_PAYOUT_AMOUNT = 100_000_000;

export interface IReferralPayoutRequest extends Document {
  user: Types.ObjectId;
  amount: number;
  status: ReferralPayoutRequestStatus;
  fundsReserved: boolean;
  approvalNote?: string;
  rejectionNote?: string;
  paymentNote?: string;
  adminReference?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  paidBy?: Types.ObjectId;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralPayoutRequestSchema = new Schema<IReferralPayoutRequest>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      immutable: true,
    },
    amount: {
      type: Number,
      required: true,
      min: MINIMUM_REFERRAL_PAYOUT_AMOUNT,
      max: MAXIMUM_REFERRAL_PAYOUT_AMOUNT,
      immutable: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "paid"],
      default: "pending",
      required: true,
      index: true,
    },
    fundsReserved: { type: Boolean, default: true, required: true, index: true },
    approvalNote: { type: String, trim: true, maxlength: 500 },
    rejectionNote: { type: String, trim: true, maxlength: 500 },
    paymentNote: { type: String, trim: true, maxlength: 500 },
    adminReference: { type: String, trim: true, maxlength: 120 },
    approvedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    approvedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    rejectedAt: { type: Date },
    paidBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

ReferralPayoutRequestSchema.index({ user: 1, status: 1, createdAt: -1 });
ReferralPayoutRequestSchema.index({ status: 1, createdAt: -1 });
ReferralPayoutRequestSchema.index(
  { user: 1, fundsReserved: 1 },
  {
    unique: true,
    partialFilterExpression: { fundsReserved: true },
    name: "one_active_referral_payout_per_user",
  },
);

export const ReferralPayoutRequest =
  mongoose.models.ReferralPayoutRequest ||
  mongoose.model<IReferralPayoutRequest>(
    "ReferralPayoutRequest",
    ReferralPayoutRequestSchema,
  );
