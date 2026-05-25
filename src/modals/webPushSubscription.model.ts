import { Document, Schema, Types, model } from "mongoose";
import { UserType } from "./notification.model";

export interface IWebPushSubscription extends Document {
  user: Types.ObjectId;
  role: UserType;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  active: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebPushSubscriptionSchema = new Schema<IWebPushSubscription>(
  {
    user: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(UserType),
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, trim: true },
    active: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

WebPushSubscriptionSchema.index({ user: 1, role: 1, active: 1 });

export const WebPushSubscription = model<IWebPushSubscription>(
  "WebPushSubscription",
  WebPushSubscriptionSchema,
);
