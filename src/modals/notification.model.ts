import mongoose, { Schema, Document, Types } from "mongoose";

export enum UserType {
  ADMIN = "admin",
  AGENT = "agent",
  WORKER = "worker",
  EMPLOYER = "employer",
  CONTRACTOR = "contractor",
  VIRTUAL_HR = "virtual_hr",
}

/** Read/Delivery status */
export type NotificationStatus = "unread" | "read" | "deleted";

/** Notification Document Interface */
export interface INotification extends Document {
  type: string;
  title: string;
  message: string;
  status: NotificationStatus;
  from?: {
    role: UserType;
    user: Types.ObjectId;
  };
  to: {
    role: UserType;
    user: Types.ObjectId;
  };
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Notification Schema */
const NotificationSchema = new Schema<INotification>(
  {
    type: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["unread", "read", "deleted"],
      default: "unread",
    },
    from: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "from.role",
      },
      role: {
        type: String,
        enum: Object.values(UserType),
      },
    },
    to: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: "to.role",
      },
      role: {
        type: String,
        enum: Object.values(UserType),
        required: true,
      },
    },
    readAt: { type: Date },
  },
  { timestamps: true }
);

// 🔍 Quickly find notifications by recipient user + status (already present, good)
NotificationSchema.index({ "to.user": 1, status: 1, createdAt: -1 });

// 📬 Optimize lookups by recipient user only (inbox)
NotificationSchema.index({ "to.user": 1 });

// 📩 Optimize notifications sent from a specific user
NotificationSchema.index({ "from.user": 1 });

// 📆 Efficient pagination by creation time
NotificationSchema.index({ createdAt: -1 });

// 🧾 Filter by notification type quickly
NotificationSchema.index({ type: 1 });

// 📌 Filter by role (useful in multi-role systems)
NotificationSchema.index({ "to.role": 1 });

export const Notification = mongoose.model<INotification>(
  "Notification",
  NotificationSchema
);
