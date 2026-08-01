import mongoose, { Document, Schema, Types } from "mongoose";

export interface ICustomerActivity extends Document {
  customer: Types.ObjectId;
  action: string;
  description: string;
  actor?: Types.ObjectId;
  actorRole?: string;
  actorEmail?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerActivitySchema = new Schema<ICustomerActivity>(
  {
    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: true, trim: true },
    actor: { type: Schema.Types.ObjectId, ref: "Admin" },
    actorRole: { type: String, trim: true },
    actorEmail: { type: String, trim: true, lowercase: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

CustomerActivitySchema.index({ customer: 1, createdAt: -1 });

export const CustomerActivity = mongoose.model<ICustomerActivity>(
  "CustomerActivity",
  CustomerActivitySchema,
);
