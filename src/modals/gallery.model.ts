import mongoose, { Document, Schema, Types } from "mongoose";

export interface IGalleryItem extends Document {
  url: string;
  order: number;
  tags: string[];
  roomId?: Types.ObjectId;
  propertyId?: Types.ObjectId;
  type: "image" | "video" | "virtual_tour" | "360_view";
  category: "exterior" | "interior" | "room" | "amenity" | "neighborhood";
}

// Gallery Item Schema
const galleryItemSchema = new Schema<IGalleryItem>(
  {
    url: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ["image", "video", "virtual_tour", "360_view"],
    },
    category: {
      type: String,
      required: true,
      enum: ["exterior", "interior", "room", "amenity", "neighborhood"],
    },
    tags: [{ type: String }],
    order: { type: Number, default: 0 },
    roomId: { type: Schema.Types.ObjectId, ref: "Room" },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
  },
  { timestamps: true }
);

galleryItemSchema.index({ category: 1, order: 1 });
export const GalleryItem = mongoose.model<IGalleryItem>(
  "GalleryItem",
  galleryItemSchema
);
