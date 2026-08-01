import { Document, Schema, Types, model } from "mongoose";
import { normalizeReferralCode } from "../utils/referral";

export type ReferralStatus = "pending" | "rewarded";
export type ReferralLifecycleStage =
  | "registered"
  | "applied"
  | "approved"
  | "reward_paid";
export type ReferralPayoutStatus =
  | "not_eligible"
  | "pending"
  | "paid"
  | "rejected";

export interface IReferralEvent extends Document {
  referralCode: string;
  status: ReferralStatus;
  referrer: Types.ObjectId;
  referredUser: Types.ObjectId;
  points: number;
  lifecycleStage: ReferralLifecycleStage;
  payoutStatus: ReferralPayoutStatus;
  rewardAmount?: number;
  disbursedAmount?: number;
  loanQuery?: Types.ObjectId;
  registeredAt?: Date;
  appliedAt?: Date;
  approvedAt?: Date;
  disbursedAt?: Date;
  rewardCreditedAt?: Date;
  rewardCreditVersion?: number;
  paidAt?: Date;
  paidBy?: Types.ObjectId;
  payoutReference?: string;
  payoutNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralEventSchema = new Schema<IReferralEvent>(
  {
    referrer: {
      ref: "User",
      index: true,
      required: true,
      type: Schema.Types.ObjectId,
    },
    referredUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referralCode: {
      type: String,
      required: true,
      trim: true,
      set: normalizeReferralCode,
    },
    status: {
      type: String,
      enum: ["pending", "rewarded"],
      default: "pending",
    },
    points: { type: Number, default: 0 },
    lifecycleStage: {
      type: String,
      enum: ["registered", "applied", "approved", "reward_paid"],
      default: "registered",
      index: true,
    },
    payoutStatus: {
      type: String,
      enum: ["not_eligible", "pending", "paid", "rejected"],
      default: "not_eligible",
      index: true,
    },
    rewardAmount: { type: Number, min: 0 },
    disbursedAmount: { type: Number, min: 0 },
    loanQuery: { type: Schema.Types.ObjectId, ref: "LoanQuery", index: true },
    registeredAt: { type: Date, default: Date.now },
    appliedAt: { type: Date },
    approvedAt: { type: Date },
    disbursedAt: { type: Date },
    rewardCreditedAt: { type: Date },
    rewardCreditVersion: { type: Number, min: 2 },
    paidAt: { type: Date },
    paidBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    payoutReference: { type: String, trim: true, maxlength: 120 },
    payoutNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

ReferralEventSchema.index({ referrer: 1, createdAt: -1 });
ReferralEventSchema.index({ referredUser: 1 }, { unique: true });
ReferralEventSchema.index({ payoutStatus: 1, rewardCreditedAt: -1 });

export const ReferralEvent = model<IReferralEvent>(
  "ReferralEvent",
  ReferralEventSchema
);
