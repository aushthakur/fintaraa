import slugify from "slugify";
import mongoose, { Document, Schema } from "mongoose";

export interface INearbyPlace extends Document {
  name: string;
  slug: string;
  address: string;
  category: string;
  location: {
    type: "Point";
    coordinates: [number, number];
  };
  createdAt?: Date;
  updatedAt?: Date;
  imageUrl?: string;
  isPopular?: boolean;
  description?: string;
  isRecommended?: boolean;
  getGoogleMapsLink(): string;
}

// ------------------- Schema --------------------
const nearbyPlaceSchema = new Schema<INearbyPlace>(
  {
    name: {
      type: String,
      required: [true, "Place name is required"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    address: {
      type: String,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "school",
        "college",
        "university",
        "hospital",
        "clinic",
        "pharmacy",
        "police_station",
        "fire_station",
        "park",
        "playground",
        "zoo",
        "mall",
        "supermarket",
        "grocery_store",
        "convenience_store",
        "restaurant",
        "cafe",
        "bar",
        "pub",
        "hotel",
        "resort",
        "guesthouse",
        "metro",
        "train_station",
        "bus_stop",
        "airport",
        "taxi_stand",
        "gym",
        "fitness_center",
        "yoga_studio",
        "sports_complex",
        "stadium",
        "bank",
        "atm",
        "temple",
        "church",
        "mosque",
        "gurudwara",
        "library",
        "museum",
        "theatre",
        "cinema",
        "beach",
        "lake",
        "river",
        "mountain",
        "government_office",
        "post_office",
        "courthouse",
        "community_center",
        "parking",
        "fuel_station",
        "car_wash",
        "car_rental",
        "electric_vehicle_station",
        "industrial_area",
        "business_park",
        "coworking_space",
        "others"
      ],
    },
    // ✅ New fields
    isRecommended: { type: Boolean, default: false, index: true },
    isPopular: { type: Boolean, default: false, index: true },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        index: "2dsphere",
        required: true, // [longitude, latitude]
        validate: {
          validator: function (v: number[]) {
            return (
              Array.isArray(v) &&
              v.length === 2 &&
              v[0] >= -180 &&
              v[0] <= 180 &&
              v[1] >= -90 &&
              v[1] <= 90
            );
          },
          message: "Coordinates must be [longitude, latitude]",
        },
      },
    },
    imageUrl: { type: String },
    description: { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ------------------- Indexes --------------------
nearbyPlaceSchema.index({ location: "2dsphere" });
nearbyPlaceSchema.index({ slug: 1 });

// ------------------- Slug Middleware --------------------
nearbyPlaceSchema.pre("save", function (next) {
  if (this.isModified("name")) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

// ------------------- Methods --------------------
nearbyPlaceSchema.methods.getGoogleMapsLink = function (): string {
  const [lng, lat] = this.location.coordinates;
  return `https://www.google.com/maps?q=${lat},${lng}`;
};

// ------------------- Model --------------------
export const NearbyPlace = mongoose.model<INearbyPlace>(
  "NearbyPlace",
  nearbyPlaceSchema
);
