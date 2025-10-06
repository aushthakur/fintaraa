import mongoose, { Document, Schema, Types } from "mongoose";

// Enums
export enum RoomType {
  GYM = "gym",
  POOL = "pool",
  ATTIC = "attic",
  GARDEN = "garden",
  OFFICE = "office",
  GARAGE = "garage",
  BALCONY = "balcony",
  TERRACE = "terrace",
  BEDROOM = "bedroom",
  KITCHEN = "kitchen",
  LAUNDRY = "laundry",
  STORAGE = "storage",
  BATHROOM = "bathroom",
  BASEMENT = "basement",
  LIVING_ROOM = "living_room",
  DINING_ROOM = "dining_room",
}

export enum AreaUnit {
  SQFT = "sqft",
  SQM = "sqm",
}

export enum DimensionUnit {
  FEET = "ft",
  METER = "m",
}

// Interfaces
export interface IRoomFeature {
  name: string;
  value: string;
  unit?: string;
}

export interface IRoom extends Document {
  name: string;
  price: number;
  type: RoomType;
  floor?: number;
  roomCount?: number;
  amenities: string[];
  description?: string;
  user: Types.ObjectId;
  maxOccupancy?: number;
  additionalCost?: number;
  features: IRoomFeature[];
  property: Types.ObjectId;
  getTotalVolume?(): number;
}

const roomFeatureSchema = new Schema<IRoomFeature>(
  {
    unit: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const roomSchema = new Schema<IRoom>(
  {
    type: {
      index: true,
      type: String,
      required: true,
      enum: Object.values(RoomType),
    },
    features: [roomFeatureSchema],
    floor: { type: Number, min: 0 },
    price: { type: Number, min: 0 },
    maxOccupancy: { type: Number, min: 1 },
    amenities: [{ type: String, trim: true }],
    description: { type: String, trim: true },
    roomCount: { type: Number, default: 0, min: 0 },
    name: { type: String, required: true, trim: true },
    additionalCost: { type: Number, default: 0, min: 0 },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

roomSchema.methods.getTotalVolume = function (): number {
  if (!this.dimensions?.length || !this.dimensions?.width || !this.dimensions?.height) return 0;
  return this.dimensions.length * this.dimensions.width * this.dimensions.height;
};

roomSchema.index({ property: 1, type: 1 });
roomSchema.index({ user: 1, name: 1 });

roomSchema.pre<IRoom>("save", function (next) {
  if (this.name) this.name = this.name.trim();
  if (this.description) this.description = this.description.trim();
  next();
});

export const Room = mongoose.model<IRoom>("Room", roomSchema);
