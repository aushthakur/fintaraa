import mongoose, { Schema, Document, Types, model } from "mongoose";

export type Frequency = "once" | "daily" | "weekly" | "monthly";

export type Priority = "low" | "medium" | "high";

export type CleaningStatus = "pending" | "in_progress" | "completed" | "missed";

/** Embedded Schedule Time */
interface IScheduleTime {
  date: Date;
  endTime?: string;
  startTime: string;
}

/** Cleaning Schedule Interface */
export interface ICleaningSchedule extends Document {
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
  isActive: boolean;
  priority: Priority;
  description: string;
  frequency: Frequency;
  roomId: Types.ObjectId;
  status: CleaningStatus;
  schedule: IScheduleTime;
  assignedTo: Types.ObjectId;
}

const CleaningScheduleSchema = new Schema<ICleaningSchedule>(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    frequency: {
      type: String,
      enum: ["once", "daily", "weekly", "monthly"],
      default: "once",
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "missed"],
      default: "pending",
    },
    schedule: {
      date: { type: Date, required: true },
      startTime: { type: String, required: true },
      endTime: { type: String },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

export const CleaningSchedule = model<ICleaningSchedule>(
  "CleaningSchedule",
  CleaningScheduleSchema
);
