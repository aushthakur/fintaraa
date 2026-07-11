import mongoose, { Document, Schema } from "mongoose";

export type NewsletterSubscriptionStatus = "active" | "unsubscribed";

export interface INewsletterSubscription extends Document {
  email: string;
  status: NewsletterSubscriptionStatus;
  source?: string;
  platform?: string;
  pagePath?: string;
  formSource?: string;
  subscribedAt?: Date;
  unsubscribedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const NewsletterSubscriptionSchema =
  new Schema<INewsletterSubscription>(
    {
      email: {
        type: String,
        trim: true,
        lowercase: true,
        required: true,
        unique: true,
        maxlength: 120,
      },
      status: {
        type: String,
        enum: ["active", "unsubscribed"],
        default: "active",
        index: true,
      },
      source: { type: String, trim: true, default: "website" },
      platform: { type: String, trim: true, default: "website" },
      pagePath: { type: String, trim: true, maxlength: 240 },
      formSource: { type: String, trim: true, default: "website_newsletter" },
      subscribedAt: { type: Date, default: Date.now },
      unsubscribedAt: { type: Date },
      ipAddress: { type: String, trim: true },
      userAgent: { type: String, trim: true },
    },
    { timestamps: true },
  );

NewsletterSubscriptionSchema.index({ createdAt: -1 });
NewsletterSubscriptionSchema.index({ status: 1, createdAt: -1 });

export const NewsletterSubscription =
  mongoose.models.NewsletterSubscription ||
  mongoose.model<INewsletterSubscription>(
    "NewsletterSubscription",
    NewsletterSubscriptionSchema,
  );
