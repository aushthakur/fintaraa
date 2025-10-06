import mongoose, { Schema, Document, model } from "mongoose";

// 1. Define the interface for the BlogCategory document
export interface IBlogCategory extends Document {
  name: string;
  type: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 2. Define the schema
const BlogCategorySchema: Schema<IBlogCategory> = new Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      maxlength: 50,
      minlength: 2,
    },
    type: {
      type: String,
      required: true,
      default: "general",
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// 3. Compound index to enforce unique name+type combination
BlogCategorySchema.index({ name: 1, type: 1 }, { unique: true });

// 4. Export the model with type safety
export const BlogCategory = mongoose.models.BlogCategory as mongoose.Model<IBlogCategory> ||
  model<IBlogCategory>("BlogCategory", BlogCategorySchema);
