import mongoose, { Document, Schema, Types } from "mongoose";

export type AgencyPayoutProfileMethod = "upi" | "bank_transfer";

export interface IAgencyPayoutProfile extends Document {
  agency: Types.ObjectId;
  method: AgencyPayoutProfileMethod;
  encryptedPayload: string;
  maskedDestination: string;
  accountHolder?: string;
  bankName?: string;
  ifsc?: string;
  encryptionVersion: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgencyPayoutProfileSchema = new Schema<IAgencyPayoutProfile>(
  {
    agency: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      required: true,
      unique: true,
      index: true,
    },
    method: {
      type: String,
      enum: ["upi", "bank_transfer"],
      required: true,
    },
    encryptedPayload: { type: String, required: true, select: false },
    maskedDestination: { type: String, required: true },
    accountHolder: { type: String, trim: true },
    bankName: { type: String, trim: true },
    ifsc: { type: String, trim: true, uppercase: true },
    encryptionVersion: { type: Number, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

export const AgencyPayoutProfile = mongoose.model<IAgencyPayoutProfile>(
  "AgencyPayoutProfile",
  AgencyPayoutProfileSchema,
);
