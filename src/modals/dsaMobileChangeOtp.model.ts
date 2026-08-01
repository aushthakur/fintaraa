import mongoose, { Document, Schema, Types } from "mongoose";

export interface IDsaMobileChangeOtp extends Document {
  agency: Types.ObjectId;
  mobile: string;
  otpHash: string;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const dsaMobileChangeOtpSchema = new Schema<IDsaMobileChangeOtp>(
  {
    agency: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      required: true,
      index: true,
    },
    mobile: { type: String, required: true, trim: true, index: true },
    otpHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
  },
  { timestamps: true },
);

dsaMobileChangeOtpSchema.index({ agency: 1, mobile: 1 }, { unique: true });
dsaMobileChangeOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DsaMobileChangeOtp = mongoose.model<IDsaMobileChangeOtp>(
  "DsaMobileChangeOtp",
  dsaMobileChangeOtpSchema,
);
