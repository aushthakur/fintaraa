import slugify from "slugify";
import mongoose, { Document, Schema, Model, model } from "mongoose";

export type KnowledgeType =
  | "blog"
  | "article"
  | "video"
  | "product_info"
  | "tutorial";

export interface IKnowledge extends Document {
  title: string;
  slug: string;
  type: KnowledgeType;
  summary?: string;
  content?: string;
  coverImageUrl?: string;
  linkUrl?: string;
  tags?: string[];
  isActive: boolean;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeSchema: Schema<IKnowledge> = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, unique: true },
    type: {
      type: String,
      required: true,
      enum: ["blog", "article", "video", "product_info", "tutorial"],
      index: true,
    },
    summary: { type: String, trim: true },
    content: { type: String },
    coverImageUrl: { type: String, trim: true, default: "" },
    linkUrl: { type: String, trim: true },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

KnowledgeSchema.pre<IKnowledge>("save", function (next) {
  if (this.isNew && !this.slug) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  next();
});

export const Knowledge: Model<IKnowledge> =
  mongoose.models.Knowledge || model<IKnowledge>("Knowledge", KnowledgeSchema);
