import mongoose, { Document, Schema, Types } from "mongoose";

export enum ReviewStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export interface IReview extends Document {
  images: any;
  title?: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
  user: Types.ObjectId;
  property: Types.ObjectId;
  booking?: Types.ObjectId;
  rating: {
    value?: number;
    overall: number;
    checkIn?: number;
    location?: number;
    accuracy?: number;
    cleanliness?: number;
    communication?: number;
  };
  status: ReviewStatus;
}

const reviewSchema = new Schema<IReview>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking" },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true },

    title: { type: String },
    images: [{ type: String }],
    comment: { type: String, required: true },

    rating: {
      checkIn: { type: Number, min: 1, max: 5 },
      location: { type: Number, min: 1, max: 5 },
      accuracy: { type: Number, min: 1, max: 5 },
      cleanliness: { type: Number, min: 1, max: 5 },
      communication: { type: Number, min: 1, max: 5 },
      overall: { type: Number, required: true, min: 1, max: 5 },
    },
    status: {
      type: String,
      enum: Object.values(ReviewStatus),
      default: ReviewStatus.PENDING,
    },
  },
  { timestamps: true }
);

// Indexes
reviewSchema.index({ user: 1 });
reviewSchema.index({ status: 1 });
reviewSchema.index({ property: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ "rating.overall": -1 });

export const Review = mongoose.model<IReview>("Review", reviewSchema);
