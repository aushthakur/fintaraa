import mongoose, { Schema, Document, Types } from "mongoose";

export enum CouponType {
  FLAT = "flat",
  PERCENTAGE = "percentage",
}

export enum CouponStatus {
  ACTIVE = "active",
  EXPIRED = "expired",
  INACTIVE = "inactive",
  UPCOMING = "upcoming",
}

export interface ICoupon extends Document {
  code: string;
  title: string;
  endDate: Date;
  startDate: Date;
  createdAt: Date;
  updatedAt: Date;
  type: CouponType;
  isPublic: boolean;
  usageLimit: number;
  description: string;
  status: CouponStatus;
  discountValue: number;
  minBookingAmount?: number;
  usageLimitPerUser?: number;
  maxDiscountAmount?: number;
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    title: {
      trim: true,
      type: String,
      required: true,
    },
    description: String,
    type: {
      type: String,
      required: true,
      enum: Object.values(CouponType),
    },
    discountValue: {
      type: Number,
      required: true,
    },
    minBookingAmount: Number,
    maxDiscountAmount: Number,
    usageLimit: { type: Number },
    usageLimitPerUser: { type: Number },
    endDate: { type: Date, required: true },
    startDate: { type: Date, required: true },
    status: {
      type: String,
      default: CouponStatus.INACTIVE,
      enum: Object.values(CouponStatus),
    },
    isPublic: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CouponSchema.index({ status: 1 });
CouponSchema.index({ startDate: 1, endDate: 1 });
CouponSchema.index({ code: 1 }, { unique: true });

export const Coupon = mongoose.model<ICoupon>("Coupon", CouponSchema);
