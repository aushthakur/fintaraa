import mongoose, { Schema, Document, model } from "mongoose";

export interface ITermsAndConditions extends Document {
  title: string;
  content: string;
  version?: string;
  isActive: boolean;
  effectiveFrom?: Date;
}

const TermsAndConditionsSchema = new Schema<ITermsAndConditions>(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    version: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    effectiveFrom: { type: Date },
  },
  { timestamps: true }
);

export const TermsAndConditions =
  mongoose.models.TermsAndConditions ||
  model<ITermsAndConditions>("TermsAndConditions", TermsAndConditionsSchema);
