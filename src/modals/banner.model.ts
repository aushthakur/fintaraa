import mongoose, { Document, Schema } from "mongoose";

export enum BannerType {
  CUSTOM = "custom",
  HOMEPAGE = "homepage",
  LOAN_DETAIL = "loan_detail",
  INSURANCE_DETAIL = "insurance_detail",
  LOAN_DETAIL_POPUP_WEB = "loan_detail_popup_web",
  LOAN_DETAIL_POPUP_MOBILE = "loan_detail_popup_mobile",
  INSURANCE_DETAIL_POPUP_WEB = "insurance_detail_popup_web",
  INSURANCE_DETAIL_POPUP_MOBILE = "insurance_detail_popup_mobile",
  CATEGORY = "category",
  PROPERTY = "property",
  PROMOTION = "promotion",
}

export enum BannerStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export const PRODUCT_SCOPED_BANNER_TYPES = [
  BannerType.LOAN_DETAIL,
  BannerType.INSURANCE_DETAIL,
  BannerType.LOAN_DETAIL_POPUP_WEB,
  BannerType.LOAN_DETAIL_POPUP_MOBILE,
  BannerType.INSURANCE_DETAIL_POPUP_WEB,
  BannerType.INSURANCE_DETAIL_POPUP_MOBILE,
] as const;

export const UPLOADED_MEDIA_BANNER_TYPES = [
  BannerType.HOMEPAGE,
  ...PRODUCT_SCOPED_BANNER_TYPES,
] as const;

export const RESPONSIVE_BANNER_TYPES = [
  BannerType.LOAN_DETAIL,
  BannerType.INSURANCE_DETAIL,
] as const;

export const isUploadedBannerMediaUrl = (value: unknown) =>
  /^https?:\/\/\S+$/i.test(String(value || "").trim());

export interface IBanner extends Document {
  title: string;
  image: string;
  mobileImage?: string;
  productSlug?: string;
  createdAt: Date;
  updatedAt: Date;
  priority: number;
  type: BannerType;
  eyebrow?: string;
  highlightText?: string;
  linkUrl?: string;
  buttonText?: string;
  secondaryButtonText?: string;
  secondaryLinkUrl?: string;
  imageAlt?: string;
  displayDurationMs?: number;
  description?: string;
  status: BannerStatus;
}

const bannerSchema = new Schema<IBanner>(
  {
    eyebrow: { type: String, trim: true },
    highlightText: { type: String, trim: true },
    description: { type: String },
    title: { type: String, required: true },
    image: {
      type: String,
      required: true,
      validate: {
        validator: function (this: IBanner, value: string) {
          const requiresUploadedMedia = UPLOADED_MEDIA_BANNER_TYPES.includes(
            this.type as (typeof UPLOADED_MEDIA_BANNER_TYPES)[number],
          );
          return !requiresUploadedMedia || isUploadedBannerMediaUrl(value);
        },
        message: "Banner image must be uploaded media",
      },
    },
    mobileImage: {
      type: String,
      trim: true,
      required: function (this: IBanner) {
        return RESPONSIVE_BANNER_TYPES.includes(
          this.type as (typeof RESPONSIVE_BANNER_TYPES)[number],
        );
      },
      validate: {
        validator: function (this: IBanner, value?: string) {
          const isResponsiveBanner = RESPONSIVE_BANNER_TYPES.includes(
            this.type as (typeof RESPONSIVE_BANNER_TYPES)[number],
          );
          return !isResponsiveBanner || isUploadedBannerMediaUrl(value);
        },
        message: "Mobile banner image must be uploaded media",
      },
    },
    productSlug: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      required: function (this: IBanner) {
        return PRODUCT_SCOPED_BANNER_TYPES.includes(
          this.type as (typeof PRODUCT_SCOPED_BANNER_TYPES)[number],
        );
      },
    },
    imageAlt: { type: String, trim: true },
    type: {
      type: String,
      default: BannerType.HOMEPAGE,
      enum: Object.values(BannerType),
    },
    linkUrl: { type: String },
    buttonText: { type: String },
    secondaryButtonText: { type: String },
    secondaryLinkUrl: { type: String },
    displayDurationMs: { type: Number, default: 5000, min: 1500, max: 30000 },
    priority: { type: Number, default: 1 },
    status: {
      type: String,
      default: BannerStatus.ACTIVE,
      enum: Object.values(BannerStatus),
    },
  },
  { timestamps: true },
);

bannerSchema.index({
  type: 1,
  productSlug: 1,
  status: 1,
  priority: 1,
  createdAt: -1,
});

export const Banner = mongoose.model<IBanner>("Banner", bannerSchema);
