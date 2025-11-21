import mongoose, { Schema, Document, model } from "mongoose";

export interface IRefundPolicy extends Document {
  title: string;
  content: string;
  version?: string;
  isActive: boolean;
  effectiveFrom?: Date;
  appliesToCancellation: boolean;
}

const RefundPolicySchema = new Schema<IRefundPolicy>(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    version: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    effectiveFrom: { type: Date },
    appliesToCancellation: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const RefundPolicy =
  mongoose.models.RefundPolicy ||
  model<IRefundPolicy>("RefundPolicy", RefundPolicySchema);
