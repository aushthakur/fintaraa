import mongoose, { Schema, Document } from "mongoose";

/**
 * Interface representing a user activity on a property listing.
 */
export interface IUserActivity extends Document {
  userId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  sessionId?: string;

  // User interaction
  actionType: "view" | "click";
  durationInSeconds?: number;

  // Device and platform data
  deviceType?: "mobile" | "desktop" | "tablet";
  platform?: "web" | "android" | "ios";
  browser?: string;
  deviceInfo?: string;
  isBot?: boolean;

  // Technical metadata
  ipAddress?: string;
  referrer?: string;
  userAgent?: string;

  // Geolocation
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;

  // Campaign/Attribution
  sourceCampaign?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

const userActivitySchema = new Schema<IUserActivity>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    sessionId: { type: String },

    // Core Action
    actionType: {
      type: String,
      enum: ["view", "click", "shortlist", "book", "share"],
      required: true,
    },
    durationInSeconds: { type: Number, min: 0 },

    // Device Info
    deviceType: {
      type: String,
      enum: ["mobile", "desktop", "tablet"],
    },
    platform: {
      type: String,
      enum: ["web", "android", "ios"],
    },
    browser: { type: String },
    deviceInfo: { type: String },
    isBot: { type: Boolean, default: false },

    // Networking
    ipAddress: { type: String },
    referrer: { type: String },
    userAgent: { type: String },

    // Geolocation
    lat: { type: Number },
    lng: { type: Number },
    city: { type: String },
    country: { type: String },

    // Attribution
    sourceCampaign: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IUserActivity>(
  "UserActivity",
  userActivitySchema
);
