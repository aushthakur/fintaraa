import mongoose, { Document, Schema } from "mongoose";

export type ContactRequestStatus =
  | "new"
  | "contacted"
  | "in_progress"
  | "closed";

export interface IContactRequest extends Document {
  fullName: string;
  mobile: string;
  email: string;
  city: string;
  message?: string;
  status: ContactRequestStatus;
  source?: string;
  platform?: string;
  formSource?: string;
  whatsappConsent?: boolean;
  communicationConsent?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ContactRequestSchema = new Schema<IContactRequest>(
  {
    fullName: { type: String, trim: true, required: true, maxlength: 80 },
    mobile: { type: String, trim: true, required: true, maxlength: 15 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      maxlength: 120,
    },
    city: { type: String, trim: true, required: true, maxlength: 80 },
    message: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["new", "contacted", "in_progress", "closed"],
      default: "new",
      index: true,
    },
    source: { type: String, trim: true, default: "website" },
    platform: { type: String, trim: true, default: "website" },
    formSource: { type: String, trim: true, default: "website_contact_page" },
    whatsappConsent: { type: Boolean, default: false },
    communicationConsent: { type: Object, default: {} },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true },
);

ContactRequestSchema.index({ createdAt: -1 });
ContactRequestSchema.index({ mobile: 1, createdAt: -1 });
ContactRequestSchema.index({ email: 1, createdAt: -1 });
ContactRequestSchema.index({ status: 1, createdAt: -1 });

export const ContactRequest = mongoose.model<IContactRequest>(
  "ContactRequest",
  ContactRequestSchema,
);
