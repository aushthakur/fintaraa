import { IFaqCategory } from "./faqcategory.model";
import mongoose, { Schema, Document, model } from "mongoose";

/**
 * FAQ Schema & Interface
 */
export interface IFaq extends Document {
  answer: string;
  createdAt: Date;
  updatedAt: Date;
  question: string;
  isActive: boolean;
  category: mongoose.Types.ObjectId | IFaqCategory;
}

const FaqSchema = new Schema<IFaq>(
  {
    isActive: { type: Boolean, default: true },
    answer: { type: String, required: true, trim: true },
    question: { type: String, required: true, trim: true },
    category: { type: Schema.Types.ObjectId, ref: "FaqCategory", required: true },
  },
  { timestamps: true }
);

export const Faq = mongoose.models.Faq || model<IFaq>("Faq", FaqSchema);