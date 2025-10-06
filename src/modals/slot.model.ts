import mongoose, { Document, Schema } from "mongoose";

export enum SlotStatus {
  BOOKED = "booked",
  BLOCKED = "blocked",
  AVAILABLE = "available",
}

export interface ISlot extends Document {
  date: Date;
  endTime: string;
  createdAt: Date;
  updatedAt: Date;
  startTime: string;
  status: SlotStatus;
  roomId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
}

const slotSchema = new Schema<ISlot>(
  {
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    date: { type: Date, required: true },
    endTime: { type: String, required: true },
    startTime: { type: String, required: true },
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    status: {
      type: String,
      enum: Object.values(SlotStatus),
      default: SlotStatus.AVAILABLE,
    },
  },
  { timestamps: true }
);

// Indexes for performance
slotSchema.index({ propertyId: 1, roomId: 1, date: 1, startTime: 1 });

export const Slot = mongoose.model<ISlot>("Slot", slotSchema);
