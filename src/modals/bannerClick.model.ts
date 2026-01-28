import mongoose, { Document, Schema, Types } from "mongoose";

export interface IBannerClick extends Document {
  bannerId: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: string;

  // Click metadata
  placement: string;
  actionType: string;
  actionValue?: string;
  actionParams?: Record<string, any>;

  // Device/Context info
  deviceInfo?: {
    platform?: string;
    osVersion?: string;
    appVersion?: string;
    deviceId?: string;
  };

  // Location context
  location?: {
    screen?: string;
    referrer?: string;
  };

  // Result of the click action
  actionResult?: {
    success: boolean;
    navigatedTo?: string;
    error?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

const bannerClickSchema = new Schema<IBannerClick>(
  {
    bannerId: {
      type: Schema.Types.ObjectId,
      ref: "AppBanner",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },

    // Click metadata
    placement: { type: String, required: true },
    actionType: { type: String, required: true },
    actionValue: { type: String },
    actionParams: { type: Schema.Types.Mixed },

    // Device/Context info
    deviceInfo: {
      platform: { type: String },
      osVersion: { type: String },
      appVersion: { type: String },
      deviceId: { type: String },
    },

    // Location context
    location: {
      screen: { type: String },
      referrer: { type: String },
    },

    // Result of the click action
    actionResult: {
      success: { type: Boolean },
      navigatedTo: { type: String },
      error: { type: String },
    },
  },
  { timestamps: true },
);

// Compound indexes for efficient analytics queries
bannerClickSchema.index({ bannerId: 1, createdAt: -1 });
bannerClickSchema.index({ placement: 1, createdAt: -1 });
bannerClickSchema.index({ userId: 1, createdAt: -1 });
bannerClickSchema.index({ createdAt: -1 });

export const BannerClick = mongoose.model<IBannerClick>(
  "BannerClick",
  bannerClickSchema,
);
