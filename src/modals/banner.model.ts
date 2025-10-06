import mongoose, { Document, Schema } from "mongoose";

export enum BannerType {
  CUSTOM = "custom",
  HOMEPAGE = "homepage",
  CATEGORY = "category",
  PROPERTY = "property",
  PROMOTION = "promotion",
}

export enum BannerStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export interface IBanner extends Document {
  title: string;
  image: string;
  createdAt: Date;
  updatedAt: Date;
  priority: number;
  type: BannerType;
  linkUrl?: string;
  buttonText?: string;
  description?: string;
  status: BannerStatus;
}

const bannerSchema = new Schema<IBanner>(
  {
    description: { type: String },
    title: { type: String, required: true },
    image: { type: String, required: true },
    type: {
      type: String,
      default: BannerType.HOMEPAGE,
      enum: Object.values(BannerType),
    },
    linkUrl: { type: String },
    buttonText: { type: String },
    priority: { type: Number, default: 1 },
    status: {
      type: String,
      default: BannerStatus.ACTIVE,
      enum: Object.values(BannerStatus),
    },
  },
  { timestamps: true }
);

export const Banner = mongoose.model<IBanner>("Banner", bannerSchema);
