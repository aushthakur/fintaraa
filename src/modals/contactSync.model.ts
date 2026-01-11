import mongoose, { Document, Schema, Types } from "mongoose";

export interface IContactSync extends Document {
  name: string;
  syncedAt: Date;
  recordId: string;
  phones: string[];
  user: Types.ObjectId;
}

const ContactSyncSchema = new Schema<IContactSync>(
  {
    user: {
      ref: "User",
      index: true,
      required: true,
      type: Schema.Types.ObjectId,
    },
    name: { type: String, trim: true },
    phones: { type: [String], default: [] },
    syncedAt: { type: Date, default: Date.now },
    recordId: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

ContactSyncSchema.index({ user: 1, recordId: 1 }, { unique: true });

export const ContactSync = mongoose.model<IContactSync>(
  "ContactSync",
  ContactSyncSchema
);
