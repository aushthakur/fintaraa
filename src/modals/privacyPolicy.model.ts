import mongoose, { Schema, Document, model } from "mongoose";

export interface IPrivacyPolicy extends Document {
  title: string;
  content: string;
  version?: string;
  isActive: boolean;
  effectiveFrom?: Date;
}

const PrivacyPolicySchema = new Schema<IPrivacyPolicy>(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    version: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    effectiveFrom: { type: Date },
  },
  { timestamps: true }
);

export const PrivacyPolicy =
  mongoose.models.PrivacyPolicy ||
  model<IPrivacyPolicy>("PrivacyPolicy", PrivacyPolicySchema);
