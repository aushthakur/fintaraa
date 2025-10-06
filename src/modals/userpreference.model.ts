import mongoose, { Document, Schema } from "mongoose";

export interface IUserPreference extends Document {
  tags?: string[];
  minBudget?: number;
  maxBudget?: number;
  roomTypes: string[];
  amenities: string[];
  propertyTypes: string[];
  preferredGuests: number;
  preferredRatings: number;
  preferredLocations: string[];
  userId: mongoose.Types.ObjectId;
  preferredCheckInTimes: string[];
  maxDistanceFromLocation?: number;
  preferredCheckOutTimes: string[];
  preferredSorting:
    | "rating"
    | "distance"
    | "price_low_to_high"
    | "price_high_to_low";
}

const userPreferenceSchema = new Schema<IUserPreference>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    tags: [{ type: String }],
    preferredLocations: [{ type: String }],
    propertyTypes: [{ type: String }],
    minBudget: { type: Number },
    maxBudget: { type: Number },
    amenities: [{ type: String }],
    roomTypes: [{ type: String }],
    maxDistanceFromLocation: { type: Number }, // in KM
    preferredCheckInTimes: [{ type: String }],
    preferredCheckOutTimes: [{ type: String }],
    preferredGuests: { type: Number, default: 1 },
    preferredRatings: { type: Number, default: 3 },
    preferredSorting: {
      type: String,
      enum: ["price_low_to_high", "price_high_to_low", "rating", "distance"],
      default: "price_low_to_high",
    },
  },
  { timestamps: true }
);

export const UserPreference = mongoose.model<IUserPreference>(
  "UserPreference",
  userPreferenceSchema
);
