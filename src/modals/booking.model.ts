import mongoose, { Document, Schema, Types } from "mongoose";

export enum BookingStatus {
  PENDING = "pending",
  NO_SHOW = "no_show",
  CONFIRMED = "confirmed",
  CANCELLED = "cancelled",
  COMPLETED = "completed",
}

export interface IBooking extends Document {
  checkInDate: Date;
  checkOutDate: Date;
  numberOfRooms: number;
  roomId: Types.ObjectId;
  guestId: Types.ObjectId;
  propertyId: Types.ObjectId;
  numberOfGuests: {
    adults: number;
    infants: number;
    children: number;
  };
  createdAt: Date;
  updatedAt: Date;
  currency: string;
  totalAmount: number;
  paymentDetails?: any;
  status: BookingStatus;
  appliedCoupon: string;
  couponId: Types.ObjectId;
  specialRequests?: string;
  orderTrackingId?: string;
  merchantReference?: string;
  cancellationPolicy?: string;
  cancellationDeadline?: Date;
  paymentStatus: "pending" | "partial" | "paid" | "refunded";
  contactInfo: {
    email: string;
    phone: string;
    emergencyContact?: string;
  };
  priceBreakdown: {
    taxes?: number;
    basePrice: number;
    discounts?: number;
    serviceFee?: number;
    cleaningFee?: number;
  };
}

const bookingSchema = new Schema<IBooking>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon" },
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    guestId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },

    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },

    numberOfRooms: { type: Number, required: true, min: 1 },

    numberOfGuests: {
      infants: { type: Number, default: 0 },
      children: { type: Number, default: 0 },
      adults: { type: Number, required: true, min: 1 },
    },

    totalAmount: { type: Number, required: true },
    currency: { type: String, required: true, default: "USD" },

    status: {
      type: String,
      enum: Object.values(BookingStatus),
      default: BookingStatus.PENDING,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "partial", "paid", "refunded"],
      default: "pending",
    },

    paymentDetails: { type: {} },
    appliedCoupon: { type: String },
    specialRequests: { type: String },
    orderTrackingId: { type: String },
    merchantReference: { type: String },
    cancellationPolicy: { type: String },
    cancellationDeadline: { type: Date },

    contactInfo: {
      email: { type: String, required: true },
      phone: { type: String, required: true },
      emergencyContact: { type: String },
    },

    priceBreakdown: {
      taxes: { type: Number, default: 0 },
      discounts: { type: Number, default: 0 },
      serviceFee: { type: Number, default: 0 },
      cleaningFee: { type: Number, default: 0 },
      basePrice: { type: Number, required: true },
      extraGuestCharges: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/* ===========================
   Indexes for Performance
   =========================== */

// Search availability for a room type in a date range
bookingSchema.index(
  { propertyId: 1, roomId: 1, checkInDate: 1, checkOutDate: 1 }
);

// Quick lookups by guest
bookingSchema.index({ guestId: 1, createdAt: -1 });

// Filter by booking status
bookingSchema.index({ status: 1 });

// For availability queries where you check overlapping bookings
bookingSchema.index({ checkInDate: 1, checkOutDate: 1 });

// To help with payment tracking
bookingSchema.index({ paymentStatus: 1, updatedAt: -1 });

// Compound index for revenue analytics per property
bookingSchema.index({ propertyId: 1, createdAt: -1, totalAmount: -1 });

export const Booking = mongoose.model<IBooking>("Booking", bookingSchema);
