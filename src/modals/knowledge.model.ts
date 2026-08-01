import slugify from "slugify";
import mongoose, { Document, Schema, Model, model } from "mongoose";

export type KnowledgeType =
  | "blog"
  | "article"
  | "testimonial"
  | "press_release"
  | "video"
  | "award"
  | "product_info"
  | "tutorial";

export interface IKnowledge extends Document {
  title: string;
  slug: string;
  type: KnowledgeType;
  summary?: string;
  content?: string;
  excerpt?: string;
  category?: string;
  sectionKey?: string;
  authorName?: string;
  authorRole?: string;
  authorAvatarUrl?: string;
  location?: string;
  rating?: number;
  readTime?: string;
  accent?: string;
  videoUrl?: string;
  youtubeUrl?: string;
  buttonLabel?: string;
  coverImageUrl?: string;
  linkUrl?: string;
  leadSource?: string;
  metaTagTitle?: string;
  metaTagDescription?: string;
  metaTagKeywords?: string[];
  tags?: string[];
  isActive: boolean;
  publishedAt?: Date;
  createdByName?: string;
  createdByRole?: string;
  editedByName?: string;
  editedByRole?: string;
  editedAt?: Date;
  createdOn?: Date;
  createdBy?: string;
  publishedOn?: Date;
  editedOn?: Date;
  editedBy?: string;
  audience?: "public" | "dsa" | "all";
  trainingType?: "pdf" | "video" | "product_guide";
  documentUrl?: string;
  thumbnailUrl?: string;
  productType?: "loan" | "insurance" | "credit_card" | "all";
  loanTypes?: string[];
  sortOrder?: number;
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
      enum: [
        "blog",
        "article",
        "testimonial",
        "press_release",
        "video",
        "award",
        "product_info",
        "tutorial",
      ],
      index: true,
    },
    summary: { type: String, trim: true },
    content: { type: String },
    excerpt: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    sectionKey: { type: String, trim: true, index: true },
    authorName: { type: String, trim: true },
    authorRole: { type: String, trim: true },
    authorAvatarUrl: { type: String, trim: true },
    location: { type: String, trim: true },
    rating: { type: Number, min: 0, max: 5 },
    readTime: { type: String, trim: true },
    accent: { type: String, trim: true },
    videoUrl: { type: String, trim: true },
    youtubeUrl: { type: String, trim: true },
    buttonLabel: { type: String, trim: true },
    coverImageUrl: { type: String, trim: true, default: "" },
    linkUrl: { type: String, trim: true },
    leadSource: { type: String, trim: true },
    audience: {
      type: String,
      enum: ["public", "dsa", "all"],
      default: "public",
      index: true,
    },
    trainingType: {
      type: String,
      enum: ["pdf", "video", "product_guide"],
      index: true,
    },
    documentUrl: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
    productType: {
      type: String,
      enum: ["loan", "insurance", "credit_card", "all"],
      default: "all",
      index: true,
    },
    loanTypes: { type: [String], default: [], index: true },
    sortOrder: { type: Number, default: 0, index: true },
    metaTagTitle: { type: String, trim: true },
    metaTagDescription: { type: String, trim: true },
    metaTagKeywords: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    publishedAt: { type: Date },
    createdByName: { type: String, trim: true },
    createdByRole: { type: String, trim: true },
    editedByName: { type: String, trim: true },
    editedByRole: { type: String, trim: true },
    editedAt: { type: Date },
    createdOn: { type: Date },
    createdBy: { type: String, trim: true },
    publishedOn: { type: Date },
    editedOn: { type: Date },
    editedBy: { type: String, trim: true },
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
