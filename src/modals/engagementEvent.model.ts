import mongoose, { Document, Schema, Types } from "mongoose";

export type EngagementEventType =
  | "page_view"
  | "click"
  | "popup_impression"
  | "banner_impression";

export type EngagementCategory =
  | "page"
  | "cta"
  | "banner"
  | "popup"
  | "phone"
  | "whatsapp"
  | "footer"
  | "navigation"
  | "other";

export interface IEngagementEvent extends Document {
  eventType: EngagementEventType;
  category: EngagementCategory;
  pageUrl: string;
  pagePath: string;
  elementName?: string;
  elementId?: string;
  placement?: string;
  targetUrl?: string;
  sessionId?: string;
  visitorId?: string;
  user?: Types.ObjectId;
  deviceType: "mobile" | "desktop" | "tablet" | "unknown";
  city?: string;
  region?: string;
  country?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  referrer?: string;
  heatmapProvider?: string;
  queryParams?: Record<string, string | string[]>;
  landingPage?: string;
  gclid?: string;
  fbclid?: string;
  dsaReferralCode?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const EngagementEventSchema = new Schema<IEngagementEvent>(
  {
    eventType: {
      type: String,
      enum: ["page_view", "click", "popup_impression", "banner_impression"],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        "page",
        "cta",
        "banner",
        "popup",
        "phone",
        "whatsapp",
        "footer",
        "navigation",
        "other",
      ],
      required: true,
      index: true,
    },
    pageUrl: { type: String, required: true, trim: true },
    pagePath: { type: String, required: true, trim: true, index: true },
    elementName: { type: String, trim: true, index: true },
    elementId: { type: String, trim: true },
    placement: { type: String, trim: true, index: true },
    targetUrl: { type: String, trim: true },
    sessionId: { type: String, trim: true, index: true },
    visitorId: { type: String, trim: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    deviceType: {
      type: String,
      enum: ["mobile", "desktop", "tablet", "unknown"],
      default: "unknown",
      index: true,
    },
    city: { type: String, trim: true, index: true },
    region: { type: String, trim: true },
    country: { type: String, trim: true },
    source: { type: String, trim: true, index: true },
    medium: { type: String, trim: true },
    campaign: { type: String, trim: true, index: true },
    term: { type: String, trim: true },
    content: { type: String, trim: true },
    referrer: { type: String, trim: true },
    heatmapProvider: { type: String, trim: true },
    queryParams: { type: Schema.Types.Mixed, default: {} },
    landingPage: { type: String, trim: true },
    gclid: { type: String, trim: true },
    fbclid: { type: String, trim: true },
    dsaReferralCode: { type: String, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

EngagementEventSchema.index({ createdAt: -1 });
EngagementEventSchema.index({ eventType: 1, createdAt: -1 });
EngagementEventSchema.index({ category: 1, createdAt: -1 });
EngagementEventSchema.index({ pagePath: 1, eventType: 1, createdAt: -1 });
EngagementEventSchema.index({ placement: 1, eventType: 1, createdAt: -1 });
EngagementEventSchema.index({ source: 1, createdAt: -1 });

export const EngagementEvent =
  mongoose.models.EngagementEvent ||
  mongoose.model<IEngagementEvent>("EngagementEvent", EngagementEventSchema);
