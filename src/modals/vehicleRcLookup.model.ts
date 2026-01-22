import mongoose, { Document, Schema, Types } from "mongoose";

export interface IVehicleRcLookup extends Document {
  fetchedAt: Date;
  idNumber: string;
  environment?: string;
  report: Record<string, any>;
  payload?: Record<string, any>;
  lastFetchedBy?: Types.ObjectId;
  lastAccessedBy?: Types.ObjectId;
  lastAccessedAt?: Date;
  fetchCount?: number;
  accessCount?: number;
}

const VehicleRcLookupSchema = new Schema<IVehicleRcLookup>(
  {
    idNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
      unique: true,
    },
    report: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    environment: {
      type: String,
      trim: true,
    },
    fetchedAt: {
      type: Date,
      required: true,
    },
    lastFetchedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastAccessedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastAccessedAt: { type: Date },
    fetchCount: { type: Number, default: 0 },
    accessCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const VehicleRcLookup = mongoose.model<IVehicleRcLookup>(
  "VehicleRcLookup",
  VehicleRcLookupSchema,
);
