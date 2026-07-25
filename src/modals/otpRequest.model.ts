import { Document, Schema, model } from "mongoose";

export interface IOtpRequest extends Document {
  mobile: string;
  scope: "user" | "agency";
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const otpRequestSchema = new Schema<IOtpRequest>(
  {
    mobile: { type: String, required: true, index: true, trim: true },
    scope: {
      type: String,
      enum: ["user", "agency"],
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpRequestSchema.index({ mobile: 1, scope: 1, createdAt: -1 });

export const OtpRequest = model<IOtpRequest>("OtpRequest", otpRequestSchema);
