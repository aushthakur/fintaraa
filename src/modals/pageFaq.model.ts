import mongoose, { Document, Schema } from "mongoose";

export type PageFaqStatus = "draft" | "active" | "archived";

export type PageFaqItem = {
  answer: string;
  question: string;
  isActive?: boolean;
  priorityOrder?: number;
};

export interface IPageFaq extends Document {
  recordType: "page_faq";
  slug: string;
  pathname: string;
  pagePathname: string;
  pathAliases: string[];
  title: string;
  subtitle?: string;
  items: PageFaqItem[];
  schemaEnabled: boolean;
  schemaJson?: Record<string, any>;
  status: PageFaqStatus;
  priorityOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const faqItemSchema = new Schema<PageFaqItem>(
  {
    question: { type: String, trim: true, required: true, maxlength: 220 },
    answer: { type: String, trim: true, required: true, maxlength: 4000 },
    isActive: { type: Boolean, default: true },
    priorityOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const pageFaqSchema = new Schema<IPageFaq>(
  {
    recordType: {
      type: String,
      default: "page_faq",
      index: true,
      immutable: true,
    },
    slug: { type: String, trim: true, required: true, index: true },
    pathname: { type: String, trim: true, required: true },
    pagePathname: { type: String, trim: true, required: true, index: true },
    pathAliases: { type: [String], default: [], index: true },
    title: {
      type: String,
      trim: true,
      default: "Frequently Asked Questions",
      maxlength: 160,
    },
    subtitle: { type: String, trim: true, maxlength: 260 },
    items: { type: [faqItemSchema], default: [] },
    schemaEnabled: { type: Boolean, default: true },
    schemaJson: { type: Object, default: undefined },
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "active",
      index: true,
    },
    priorityOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);

pageFaqSchema.index(
  { recordType: 1, pagePathname: 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: "page_faq" },
  },
);
pageFaqSchema.index({ recordType: 1, status: 1, priorityOrder: 1 });

export const PageFaq =
  mongoose.models.PageFaq ||
  mongoose.model<IPageFaq>("PageFaq", pageFaqSchema, "knowledges");
