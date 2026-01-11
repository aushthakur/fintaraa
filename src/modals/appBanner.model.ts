import mongoose, { Document, Schema } from "mongoose";

export enum AppBannerStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum AppBannerAudience {
  B2C = "b2c",
  B2B = "b2b",
  BOTH = "both",
}

export enum AppBannerActionType {
  NONE = "none",
  WEBVIEW = "webview",
  INTERNAL = "internal",
  EXTERNAL = "external",
}

// Keep this open-ended to support adding placements without migrations.
export type AppBannerPlacement = string;

export interface IAppBanner extends Document {
  title?: string;
  description?: string;
  image: string;
  buttonText?: string;

  priority: number;
  status: AppBannerStatus;
  audience: AppBannerAudience;
  placement: AppBannerPlacement;

  actionType: AppBannerActionType;
  actionValue?: string;
  actionParams?: Record<string, any>;

  startAt?: Date;
  endAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const appBannerSchema = new Schema<IAppBanner>(
  {
    title: { type: String },
    description: { type: String },
    image: { type: String, required: true },
    buttonText: { type: String },

    priority: { type: Number, default: 1 },
    status: {
      type: String,
      default: AppBannerStatus.ACTIVE,
      enum: Object.values(AppBannerStatus),
    },
    audience: {
      type: String,
      default: AppBannerAudience.BOTH,
      enum: Object.values(AppBannerAudience),
    },
    placement: { type: String, required: true },

    actionType: {
      type: String,
      default: AppBannerActionType.NONE,
      enum: Object.values(AppBannerActionType),
    },
    actionValue: { type: String },
    actionParams: { type: Schema.Types.Mixed },

    startAt: { type: Date },
    endAt: { type: Date },
  },
  { timestamps: true }
);

export const AppBanner = mongoose.model<IAppBanner>("AppBanner", appBannerSchema);
