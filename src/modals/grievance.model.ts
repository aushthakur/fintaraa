import mongoose, { Document, Schema, Types } from "mongoose";

export enum GrievanceStatus {
  OPEN = "open",
  IN_PROGRESS = "in_progress",
  RESOLVED = "resolved",
  ESCALATED = "escalated",
}

export enum GrievanceNature {
  LOAN_APPLICATION = "loan_application",
  DISBURSEMENT = "disbursement",
  DOCUMENTS_KYC = "documents_kyc",
  PAYMENT_REFUND = "payment_refund",
  INSURANCE = "insurance",
  CREDIT_CARD = "credit_card",
  DATA_PRIVACY = "data_privacy",
  CUSTOMER_SERVICE = "customer_service",
  STAFF_CONDUCT = "staff_conduct",
  TECHNICAL = "technical",
  OTHER = "other",
}

export enum GrievanceCommentAuthor {
  ADMIN = "admin",
  SYSTEM = "system",
}

export interface IGrievanceComment {
  _id?: Types.ObjectId;
  authorType: GrievanceCommentAuthor;
  author?: Types.ObjectId;
  message: string;
  visibleToUser: boolean;
  createdAt: Date;
}

export interface IGrievanceStatusHistory {
  _id?: Types.ObjectId;
  fromStatus?: GrievanceStatus;
  toStatus: GrievanceStatus;
  note?: string;
  changedBy?: Types.ObjectId;
  createdAt: Date;
}

export interface IGrievance extends Document {
  ticketNumber: string;
  user?: Types.ObjectId;
  fullName: string;
  mobile: string;
  email: string;
  applicationId?: string;
  nature: GrievanceNature;
  description: string;
  status: GrievanceStatus;
  resolutionNote?: string;
  comments: IGrievanceComment[];
  statusHistory: IGrievanceStatusHistory[];
  slaDueAt: Date;
  resolvedAt?: Date;
  escalatedAt?: Date;
  lastAdminResponseAt?: Date;
  source: string;
  sourcePage?: string;
  createdByIpHash?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const grievanceCommentSchema = new Schema<IGrievanceComment>(
  {
    authorType: {
      type: String,
      enum: Object.values(GrievanceCommentAuthor),
      required: true,
    },
    author: { type: Schema.Types.ObjectId, ref: "Admin" },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    visibleToUser: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const grievanceStatusHistorySchema = new Schema<IGrievanceStatusHistory>(
  {
    fromStatus: {
      type: String,
      enum: Object.values(GrievanceStatus),
    },
    toStatus: {
      type: String,
      enum: Object.values(GrievanceStatus),
      required: true,
    },
    note: { type: String, trim: true, maxlength: 4000 },
    changedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const grievanceSchema = new Schema<IGrievance>(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    mobile: { type: String, required: true, trim: true, maxlength: 15 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    applicationId: { type: String, trim: true, maxlength: 100, index: true },
    nature: {
      type: String,
      required: true,
      enum: Object.values(GrievanceNature),
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 20,
      maxlength: 5000,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(GrievanceStatus),
      default: GrievanceStatus.OPEN,
      index: true,
    },
    resolutionNote: { type: String, trim: true, maxlength: 4000 },
    comments: { type: [grievanceCommentSchema], default: [] },
    statusHistory: { type: [grievanceStatusHistorySchema], default: [] },
    slaDueAt: { type: Date, required: true, index: true },
    resolvedAt: { type: Date },
    escalatedAt: { type: Date },
    lastAdminResponseAt: { type: Date },
    source: { type: String, trim: true, default: "website", index: true },
    sourcePage: { type: String, trim: true },
    createdByIpHash: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true },
);

grievanceSchema.index({ status: 1, slaDueAt: 1, createdAt: -1 });
grievanceSchema.index({ nature: 1, status: 1, createdAt: -1 });
grievanceSchema.index({ email: 1, createdAt: -1 });
grievanceSchema.index({ mobile: 1, createdAt: -1 });

export const Grievance =
  mongoose.models.Grievance ||
  mongoose.model<IGrievance>("Grievance", grievanceSchema);
