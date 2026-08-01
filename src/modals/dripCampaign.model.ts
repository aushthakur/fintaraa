import mongoose, { Document, Schema, Types } from "mongoose";
import { CommunicationChannel } from "./communicationOutbox.model";

export interface IDripCampaignStep {
  _id?: Types.ObjectId;
  name: string;
  delayMinutes: number;
  channels: CommunicationChannel[];
  emailSubject?: string;
  emailHtml?: string;
  smsTemplateId?: string;
  smsMessage?: string;
  whatsappTemplateName?: string;
  actionUrl?: string;
}

export interface IDripCampaign extends Document {
  name: string;
  trigger: "application_abandoned";
  isActive: boolean;
  steps: IDripCampaignStep[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DripCampaignStepSchema = new Schema<IDripCampaignStep>(
  {
    name: { type: String, required: true, trim: true },
    delayMinutes: { type: Number, required: true, min: 5, max: 43200 },
    channels: {
      type: [String],
      enum: Object.values(CommunicationChannel),
      default: [CommunicationChannel.EMAIL],
    },
    emailSubject: { type: String, trim: true },
    emailHtml: { type: String },
    smsTemplateId: { type: String, trim: true },
    smsMessage: { type: String },
    whatsappTemplateName: { type: String, trim: true },
    actionUrl: { type: String, trim: true },
  },
  { _id: true },
);

const DripCampaignSchema = new Schema<IDripCampaign>(
  {
    name: { type: String, required: true, trim: true },
    trigger: {
      type: String,
      enum: ["application_abandoned"],
      default: "application_abandoned",
      required: true,
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    steps: { type: [DripCampaignStepSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
);

DripCampaignSchema.index({ trigger: 1, isActive: 1 });

export const DripCampaign =
  mongoose.models.DripCampaign ||
  mongoose.model<IDripCampaign>("DripCampaign", DripCampaignSchema);
