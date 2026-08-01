import mongoose, { Document, Schema, Types } from "mongoose";

export enum PopupContentType {
  IMAGE = "image",
  HTML = "html",
}

export enum PopupType {
  LEAD_CAPTURE = "lead_capture",
  OFFER_ANNOUNCEMENT = "offer_announcement",
  EVENT_ANNOUNCEMENT = "event_announcement",
  SURVEY = "survey",
}

export enum PopupTriggerType {
  PAGE_LOAD = "page_load",
  EXIT_INTENT = "exit_intent",
  TIME_DELAY = "time_delay",
  SCROLL_PERCENTAGE = "scroll_percentage",
}

export enum PopupFrequency {
  ONCE_PER_SESSION = "once_per_session",
  ONCE_PER_DAY = "once_per_day",
  ALWAYS = "always",
}

export enum PopupCampaignStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum PopupFieldType {
  TEXT = "text",
  EMAIL = "email",
  TEL = "tel",
  NUMBER = "number",
  TEXTAREA = "textarea",
  SELECT = "select",
  RADIO = "radio",
  CHECKBOX = "checkbox",
  RATING = "rating",
}

export interface IPopupFormField {
  _id?: Types.ObjectId;
  name: string;
  label: string;
  type: PopupFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface IPopupCampaign extends Document {
  name: string;
  popupType: PopupType;
  contentType: PopupContentType;
  heading?: string;
  description?: string;
  imageUrl?: string;
  mobileImageUrl?: string;
  imageAlt?: string;
  htmlContent?: string;
  ctaText?: string;
  ctaUrl?: string;
  triggerType: PopupTriggerType;
  delaySeconds: number;
  scrollPercentage: number;
  targetPages: string[];
  frequency: PopupFrequency;
  formFields: IPopupFormField[];
  submitButtonText: string;
  successMessage: string;
  priority: number;
  dismissible: boolean;
  status: PopupCampaignStatus;
  startsAt?: Date;
  endsAt?: Date;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const popupFormFieldSchema = new Schema<IPopupFormField>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{0,49}$/,
    },
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: Object.values(PopupFieldType),
      default: PopupFieldType.TEXT,
    },
    required: { type: Boolean, default: false },
    placeholder: { type: String, trim: true },
    options: { type: [String], default: [] },
  },
  { _id: true },
);

const popupCampaignSchema = new Schema<IPopupCampaign>(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    popupType: {
      type: String,
      required: true,
      enum: Object.values(PopupType),
      default: PopupType.OFFER_ANNOUNCEMENT,
      index: true,
    },
    contentType: {
      type: String,
      required: true,
      enum: Object.values(PopupContentType),
      default: PopupContentType.IMAGE,
    },
    heading: { type: String, trim: true, maxlength: 180 },
    description: { type: String, trim: true, maxlength: 1200 },
    imageUrl: { type: String, trim: true },
    mobileImageUrl: { type: String, trim: true },
    imageAlt: { type: String, trim: true, maxlength: 180 },
    htmlContent: { type: String },
    ctaText: { type: String, trim: true, maxlength: 80 },
    ctaUrl: { type: String, trim: true, maxlength: 1200 },
    triggerType: {
      type: String,
      required: true,
      enum: Object.values(PopupTriggerType),
      default: PopupTriggerType.PAGE_LOAD,
    },
    delaySeconds: { type: Number, default: 5, min: 1, max: 3600 },
    scrollPercentage: { type: Number, default: 50, min: 5, max: 100 },
    targetPages: { type: [String], default: ["*"] },
    frequency: {
      type: String,
      required: true,
      enum: Object.values(PopupFrequency),
      default: PopupFrequency.ONCE_PER_SESSION,
    },
    formFields: { type: [popupFormFieldSchema], default: [] },
    submitButtonText: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "Submit",
    },
    successMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "Thank you. We have received your response.",
    },
    priority: { type: Number, default: 100, min: 1, max: 10000 },
    dismissible: { type: Boolean, default: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(PopupCampaignStatus),
      default: PopupCampaignStatus.INACTIVE,
      index: true,
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
);

popupCampaignSchema.index({
  status: 1,
  priority: 1,
  startsAt: 1,
  endsAt: 1,
});
popupCampaignSchema.index({ popupType: 1, createdAt: -1 });

export const PopupCampaign =
  mongoose.models.PopupCampaign ||
  mongoose.model<IPopupCampaign>("PopupCampaign", popupCampaignSchema);
