import { IPlan } from "./subscription.model";
import mongoose, { Schema, Document, model } from "mongoose";

export interface IBookingEnrollment extends Document {
  endDate: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  startDate: Date;
  usedUnits: number;
  totalUnits: number;
  autoRenew: boolean;
  isExpired?: boolean;
  paymentReference?: string;
  userId: mongoose.Types.ObjectId;
  additionalUnitsPurchased: number;
  planId: mongoose.Types.ObjectId | IPlan;
  status: "active" | "expired" | "cancelled";
}

const BookingEnrollmentSchema = new Schema<IBookingEnrollment>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    planId: { type: Schema.Types.ObjectId, required: true, ref: "Plan" },

    endDate: { type: Date, required: true },
    startDate: { type: Date, required: true },

    usedUnits: { type: Number, default: 0 },
    totalUnits: { type: Number, required: true },
    additionalUnitsPurchased: { type: Number, default: 0 },
    paymentReference: { type: String },
    status: {
      type: String,
      default: "active",
      enum: ["active", "expired", "cancelled"],
    },
    notes: { type: String },
    autoRenew: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: isExpired
BookingEnrollmentSchema.virtual("isExpired").get(function (this: IBookingEnrollment) {
  return new Date() > this.endDate;
});

export const BookingEnrollment =
  mongoose.models.BookingEnrollment ||
  model<IBookingEnrollment>("BookingEnrollment", BookingEnrollmentSchema);
