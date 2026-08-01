import mongoose, { Document, Schema, Types } from "mongoose";
import { PopupType } from "./popupCampaign.model";

export interface IPopupSubmission extends Document {
  popup?: Types.ObjectId;
  popupName: string;
  popupType: PopupType;
  values: Record<string, string | number | boolean>;
  contactName?: string;
  email?: string;
  mobile?: string;
  sourcePage: string;
  pageUrl?: string;
  sessionId?: string;
  visitorId?: string;
  user?: Types.ObjectId;
  deviceType?: string;
  city?: string;
  region?: string;
  country?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  referrer?: string;
  landingPage?: string;
  queryParams?: Record<string, string | string[]>;
  gclid?: string;
  fbclid?: string;
  dsaReferralCode?: string;
  attribution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const popupSubmissionSchema = new Schema<IPopupSubmission>(
  {
    popup: {
      type: Schema.Types.ObjectId,
      ref: "PopupCampaign",
      index: true,
    },
    popupName: { type: String, required: true, trim: true },
    popupType: {
      type: String,
      required: true,
      enum: Object.values(PopupType),
      index: true,
    },
    values: { type: Schema.Types.Mixed, required: true },
    contactName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    mobile: { type: String, trim: true },
    sourcePage: { type: String, required: true, trim: true, index: true },
    pageUrl: { type: String, trim: true },
    sessionId: { type: String, trim: true },
    visitorId: { type: String, trim: true },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    deviceType: {
      type: String,
      enum: ["mobile", "tablet", "desktop", "unknown"],
      default: "unknown",
    },
    city: { type: String, trim: true },
    region: { type: String, trim: true },
    country: { type: String, trim: true },
    source: { type: String, trim: true },
    medium: { type: String, trim: true },
    campaign: { type: String, trim: true },
    term: { type: String, trim: true },
    content: { type: String, trim: true },
    referrer: { type: String, trim: true },
    landingPage: { type: String, trim: true },
    queryParams: { type: Schema.Types.Mixed, default: {} },
    gclid: { type: String, trim: true },
    fbclid: { type: String, trim: true },
    dsaReferralCode: { type: String, trim: true },
    attribution: { type: Schema.Types.Mixed, default: {} },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

popupSubmissionSchema.index({ createdAt: -1 });
popupSubmissionSchema.index({ popup: 1, createdAt: -1 });
popupSubmissionSchema.index({ sourcePage: 1, createdAt: -1 });
popupSubmissionSchema.index({ email: 1, createdAt: -1 });
popupSubmissionSchema.index({ mobile: 1, createdAt: -1 });

export const PopupSubmission =
  mongoose.models.PopupSubmission ||
  mongoose.model<IPopupSubmission>(
    "PopupSubmission",
    popupSubmissionSchema,
  );
