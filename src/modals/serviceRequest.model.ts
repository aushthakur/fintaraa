import { Document, Schema, Types, model } from "mongoose";

export enum ServiceRequestType {
  GST = "gst_registration",
  ITR = "itr_filing",
  COMPANY = "company_registration",
  FRANCHISE = "franchise_partner",
  DSA = "dsa_partner",
}

export enum ServiceRequestStatus {
  OPEN = "open",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export type ServiceWorkflowItem = {
  stage: string;
  status: "pending" | "active" | "completed" | "blocked";
  remarks?: string;
  updatedBy?: string;
  updatedAt?: Date;
};

export interface IServiceRequest extends Document {
  recordType: "service_request";
  queryId: string;
  serviceType: ServiceRequestType;
  user?: Types.ObjectId;
  name?: string;
  mobile: string;
  email?: string;
  businessName?: string;
  businessType?: string;
  gstRequirement?: string;
  state?: string;
  employmentType?: string;
  annualIncome?: string;
  source?: string;
  platform?: string;
  whatsappConsent?: boolean;
  communicationConsent?: Record<string, any>;
  status: ServiceRequestStatus;
  currentStage: string;
  currentStageIndex: number;
  assignedExecutive?: string;
  details?: Record<string, any>;
  documents?: Array<{
    name: string;
    url: string;
    status?: string;
  }>;
  timeline: ServiceWorkflowItem[];
  createdAt: Date;
  updatedAt: Date;
}

const timelineSchema = new Schema<ServiceWorkflowItem>(
  {
    stage: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "blocked"],
      default: "pending",
    },
    remarks: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const serviceRequestSchema = new Schema<IServiceRequest>(
  {
    recordType: {
      type: String,
      default: "service_request",
      index: true,
      immutable: true,
    },
    queryId: { type: String, required: true, index: true },
    serviceType: {
      type: String,
      enum: Object.values(ServiceRequestType),
      required: true,
      index: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    name: { type: String, trim: true },
    mobile: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true },
    businessName: { type: String, trim: true },
    businessType: { type: String, trim: true },
    gstRequirement: { type: String, trim: true },
    state: { type: String, trim: true },
    employmentType: { type: String, trim: true },
    annualIncome: { type: String, trim: true },
    source: { type: String, trim: true, default: "website", index: true },
    platform: { type: String, trim: true, default: "website", index: true },
    whatsappConsent: { type: Boolean, default: false },
    communicationConsent: { type: Object, default: {} },
    status: {
      type: String,
      enum: Object.values(ServiceRequestStatus),
      default: ServiceRequestStatus.OPEN,
      index: true,
    },
    currentStage: { type: String, required: true, trim: true },
    currentStageIndex: { type: Number, default: 0 },
    assignedExecutive: { type: String, trim: true },
    details: { type: Object, default: {} },
    documents: {
      type: [
        {
          name: { type: String, trim: true },
          url: { type: String, trim: true },
          status: { type: String, trim: true },
        },
      ],
      default: [],
    },
    timeline: { type: [timelineSchema], default: [] },
  },
  { timestamps: true }
);

serviceRequestSchema.index({
  recordType: 1,
  serviceType: 1,
  status: 1,
  updatedAt: -1,
});
serviceRequestSchema.index({ recordType: 1, user: 1, createdAt: -1 });
serviceRequestSchema.index(
  { recordType: 1, queryId: 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: "service_request" },
  },
);

export const ServiceRequest = model<IServiceRequest>(
  "ServiceRequest",
  serviceRequestSchema,
  "formsubmitclicks",
);
