import { Document, Schema, model } from "mongoose";

export interface IOtpVerificationAttempt extends Document {
  scope: "user" | "agency";
  dimension: "mobile" | "ip";
  keyHash: string;
  failures: number;
  expiresAt: Date;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const otpVerificationAttemptSchema = new Schema<IOtpVerificationAttempt>(
  {
    scope: { type: String, enum: ["user", "agency"], required: true },
    dimension: { type: String, enum: ["mobile", "ip"], required: true },
    keyHash: { type: String, required: true },
    failures: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
    lockedUntil: { type: Date },
  },
  { timestamps: true },
);

otpVerificationAttemptSchema.index(
  { scope: 1, dimension: 1, keyHash: 1 },
  { unique: true, name: "otp_verification_counter_unique" },
);
otpVerificationAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpVerificationAttempt = model<IOtpVerificationAttempt>(
  "OtpVerificationAttempt",
  otpVerificationAttemptSchema,
);
