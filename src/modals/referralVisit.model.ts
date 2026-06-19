import mongoose, { Document, Schema, Types } from "mongoose";

export interface IReferralVisit extends Document {
  recordType: "referral_visit";
  referralCode: string;
  referrer?: Types.ObjectId;
  visitorId?: string;
  landingPath?: string;
  source?: string;
  ipAddress?: string;
  userAgent?: string;
  convertedUser?: Types.ObjectId;
  convertedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReferralVisitSchema = new Schema<IReferralVisit>(
  {
    recordType: {
      type: String,
      default: "referral_visit",
      index: true,
      immutable: true,
    },
    referralCode: { type: String, trim: true, required: true, index: true },
    referrer: { type: Schema.Types.ObjectId, ref: "User", index: true },
    visitorId: { type: String, trim: true, index: true },
    landingPath: { type: String, trim: true },
    source: { type: String, trim: true, default: "website" },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    convertedUser: { type: Schema.Types.ObjectId, ref: "User" },
    convertedAt: { type: Date },
  },
  { timestamps: true }
);

ReferralVisitSchema.index({ recordType: 1, referrer: 1, createdAt: -1 });
ReferralVisitSchema.index({
  recordType: 1,
  referralCode: 1,
  visitorId: 1,
  createdAt: -1,
});

export const ReferralVisit =
  mongoose.models.ReferralVisit ||
  mongoose.model<IReferralVisit>(
    "ReferralVisit",
    ReferralVisitSchema,
    "formsubmitclicks",
  );
