import mongoose, { Schema, Document, model } from "mongoose";

/**
 * FAQ Category Schema & Interface
 */
export interface IFaqCategory extends Document {
  name: string;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
}

const FaqCategorySchema = new Schema<IFaqCategory>(
  {
    description: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export const FaqCategory =
  mongoose.models.FaqCategory ||
  model<IFaqCategory>("FaqCategory", FaqCategorySchema);
