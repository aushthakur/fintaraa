import mongoose, { Document, Schema, Types } from "mongoose";

export interface IReferralProgramConfig extends Document {
  singletonKey: "default";
  rewardAmount: number;
  minimumDisbursementAmount: number;
  isActive: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralProgramConfigSchema = new Schema<IReferralProgramConfig>(
  {
    singletonKey: {
      type: String,
      enum: ["default"],
      default: "default",
      unique: true,
      immutable: true,
    },
    rewardAmount: { type: Number, default: 500, min: 1, max: 100000 },
    minimumDisbursementAmount: {
      type: Number,
      default: 0,
      min: 0,
      max: 1000000000,
    },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
);

export const ReferralProgramConfig =
  mongoose.models.ReferralProgramConfig ||
  mongoose.model<IReferralProgramConfig>(
    "ReferralProgramConfig",
    ReferralProgramConfigSchema,
  );
