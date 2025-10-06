import mongoose, { Document, Schema } from "mongoose";

export interface IOtp extends Document {
  otp: string;
  mobile: string;
  expiresAt: Date;
  verified: boolean;
}

const otpSchema = new Schema<IOtp>(
  {
    otp: { type: String, required: true },
    mobile: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// TTL index to auto-delete documents 5 minutes after the 'expiresAt' time
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

const Otp = mongoose.model<IOtp>("Otp", otpSchema);
export default Otp;
