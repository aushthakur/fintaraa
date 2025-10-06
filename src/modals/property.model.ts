import mongoose, { Document, Schema, Types } from "mongoose";

// Enums and Types
export enum PropertyType {
  LOFT = "loft",
  VILLA = "villa",
  HOUSE = "house",
  CONDO = "condo",
  RETAIL = "retail",
  STUDIO = "studio",
  OFFICE = "office",
  TOWNHOUSE = "townhouse",
  APARTMENT = "apartment",
  PENTHOUSE = "penthouse",
  WAREHOUSE = "warehouse",
  COMMERCIAL = "commercial",
}

export enum ListingStatus {
  SOLD = "sold",
  DRAFT = "draft",
  ACTIVE = "active",
  RENTED = "rented",
  PENDING = "pending",
  INACTIVE = "inactive",
}

// Interfaces
export interface IAddress {
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  neighborhood?: string;
  landmark?: string;
}

export interface IProperty extends Document {
  title: string;
  address: IAddress;
  description: string;
  owner: Types.ObjectId;
  propertyType: PropertyType;

  // Basic Property Details
  floors: number;
  bedrooms: number;
  totalArea: number;
  bathrooms: number;
  totalRooms: number;
  builtYear?: number;
  parkingSpaces?: number;
  areaUnit: "sqft" | "sqm";

  amenities: Types.ObjectId[];
  nearbyPlaces?: Types.ObjectId[];

  // Listing Management
  views: number;
  favorites: number;
  isVerified: boolean;
  status: ListingStatus;

  // Rules and Policies
  houseRules?: string[];
  smokingAllowed: boolean;
  partiesAllowed: boolean;
  childrenAllowed: boolean;
  petPolicy?: "allowed" | "not_allowed";

  // Timestamps and Management
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;

  // Reviews and Ratings
  averageRating?: number;
  totalReviews?: number;

  // Legal and Compliance
  licenseNumber?: string;
  taxId?: string;
  insuranceInfo?: {
    provider: string;
    policyNumber: string;
    expiryDate: Date;
  };
}

// Main Property Schema
const addressSchema = new Schema({
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  country: { type: String, required: true },
  zipCode: { type: String, required: true },
  coordinates: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  neighborhood: { type: String },
  landmark: { type: String },
});

const propertySchema = new Schema<IProperty>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    propertyType: {
      type: String,
      enum: Object.values(PropertyType),
      required: true,
    },
    address: { type: addressSchema, required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // Basic Details
    builtYear: { type: Number },
    floors: { type: Number, required: true },
    bedrooms: { type: Number, required: true },
    bathrooms: { type: Number, required: true },
    totalArea: { type: Number, required: true },
    parkingSpaces: { type: Number, default: 0 },
    totalRooms: { type: Number, required: true },
    areaUnit: { type: String, enum: ["sqft", "sqm"], required: true },

    amenities: [{ type: Schema.Types.ObjectId, ref: "Amenity" }],
    nearbyPlaces: [{ type: Schema.Types.ObjectId, ref: "NearbyPlace" }],

    // Listing Management
    status: {
      type: String,
      default: ListingStatus.INACTIVE,
      enum: Object.values(ListingStatus),
    },
    views: { type: Number, default: 0 },
    favorites: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },

    // Rules and Policies
    houseRules: [{ type: String }],
    petPolicy: {
      type: String,
      default: "not_allowed",
      enum: ["allowed", "not_allowed"],
    },
    smokingAllowed: { type: Boolean, default: false },
    partiesAllowed: { type: Boolean, default: false },
    childrenAllowed: { type: Boolean, default: true },

    // Reviews
    totalReviews: { type: Number, default: 0 },
    averageRating: { type: Number, min: 0, max: 5 },

    // Legal
    licenseNumber: { type: String },
    taxId: { type: String },
    insuranceInfo: {
      provider: { type: String },
      expiryDate: { type: Date },
      policyNumber: { type: String },
    },
  },
  { timestamps: true }
);

// Indexes for performance
propertySchema.index({ slug: 1 });
propertySchema.index({ owner: 1 });
propertySchema.index({ status: 1, isVerified: 1 });
propertySchema.index({ bedrooms: 1, bathrooms: 1 });
propertySchema.index({ "address.coordinates": "2dsphere" });
propertySchema.index({ propertyType: 1, transactionType: 1 });
propertySchema.index({ "address.city": 1, "address.state": 1 });

export const Property = mongoose.model<IProperty>("Property", propertySchema);