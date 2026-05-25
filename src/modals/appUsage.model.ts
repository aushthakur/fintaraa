import { Document, Schema, Types, model } from "mongoose";

export type AppUsageAppType = "b2b" | "b2c" | "admin";

export interface IAppUsage extends Document {
  appType: AppUsageAppType;
  user?: Types.ObjectId;
  userRole?: string;
  mobile?: string;
  event: string;
  source?: string;
  deviceId?: string;
  deviceInfo?: Record<string, any>;
  metadata?: Record<string, any>;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppUsageSchema = new Schema<IAppUsage>(
  {
    appType: {
      type: String,
      enum: ["b2b", "b2c", "admin"],
      required: true,
      index: true,
    },
    user: { type: Schema.Types.ObjectId, refPath: "userRole", index: true },
    userRole: { type: String, trim: true },
    mobile: { type: String, trim: true, index: true },
    event: { type: String, required: true, trim: true, default: "active" },
    source: { type: String, trim: true },
    deviceId: { type: String, trim: true },
    deviceInfo: { type: Schema.Types.Mixed, default: {} },
    metadata: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

AppUsageSchema.index({ appType: 1, occurredAt: -1 });
AppUsageSchema.index({ appType: 1, event: 1, occurredAt: -1 });

export const AppUsage = model<IAppUsage>("AppUsage", AppUsageSchema);
