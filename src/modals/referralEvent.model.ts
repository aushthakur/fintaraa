import { Document, Schema, Types, model } from "mongoose";

export type ReferralStatus = "pending" | "rewarded";

export interface IReferralEvent extends Document {
  referralCode: string;
  status: ReferralStatus;
  referrer: Types.ObjectId;
  referredUser: Types.ObjectId;
  points: number;
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
      index: true,
    },
    referralCode: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "rewarded"],
      default: "rewarded",
    },
    points: { type: Number, default: 100 },
  },
  { timestamps: true }
);

ReferralEventSchema.index({ referrer: 1, createdAt: -1 });

export const ReferralEvent = model<IReferralEvent>(
  "ReferralEvent",
  ReferralEventSchema
);
