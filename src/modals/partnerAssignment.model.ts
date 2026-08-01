import mongoose, { Document, Schema, Types } from "mongoose";

export enum PartnerApplicationType {
  LOAN = "loan",
  INSURANCE = "insurance",
}

export enum PartnerAssignmentMode {
  MANUAL = "manual",
  AUTO = "auto",
}

export enum PartnerAssignmentStatus {
  SUGGESTED = "suggested",
  ASSIGNED = "assigned",
  SENT = "sent",
  ACCEPTED = "accepted",
  REJECTED = "rejected",
  APPROVED = "approved",
  DISBURSED = "disbursed",
  POLICY_ISSUED = "policy_issued",
}

export interface IPartnerMatchCheck {
  field: string;
  label: string;
  actual?: unknown;
  expected?: unknown;
  passed?: boolean | null;
  skipped?: boolean;
  weight?: number;
  score?: number;
  reason: string;
}

export interface IPartnerAssignment extends Document {
  applicationType: PartnerApplicationType;
  applicationModel: "LoanQuery" | "InsuranceQuery";
  application: Types.ObjectId;
  applicationId: string;
  partner: Types.ObjectId;
  product: Types.ObjectId;
  mode: PartnerAssignmentMode;
  matchScore?: number;
  matchReasons: string[];
  matchChecks: IPartnerMatchCheck[];
  status: PartnerAssignmentStatus;
  externalApplicationId?: string;
  assignedAt: Date;
  sentAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  approvedAt?: Date;
  disbursedAt?: Date;
  policyIssuedAt?: Date;
  decisionAt?: Date;
  assignedBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  auditHistory: Array<{
    fromStatus?: PartnerAssignmentStatus;
    toStatus: PartnerAssignmentStatus;
    note?: string;
    actor?: Types.ObjectId;
    metadata?: Record<string, any>;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const matchCheckSchema = new Schema<IPartnerMatchCheck>(
  {
    field: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    actual: { type: Schema.Types.Mixed },
    expected: { type: Schema.Types.Mixed },
    passed: { type: Boolean, default: null },
    skipped: { type: Boolean, default: false },
    weight: { type: Number, min: 0, default: 0 },
    score: { type: Number, min: 0, default: 0 },
    reason: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const auditSchema = new Schema(
  {
    fromStatus: { type: String, enum: Object.values(PartnerAssignmentStatus) },
    toStatus: {
      type: String,
      enum: Object.values(PartnerAssignmentStatus),
      required: true,
    },
    note: { type: String, trim: true, default: "", maxlength: 2000 },
    actor: { type: Schema.Types.ObjectId, ref: "Admin" },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const partnerAssignmentSchema = new Schema<IPartnerAssignment>(
  {
    applicationType: {
      type: String,
      enum: Object.values(PartnerApplicationType),
      required: true,
      index: true,
    },
    applicationModel: {
      type: String,
      enum: ["LoanQuery", "InsuranceQuery"],
      required: true,
    },
    application: {
      type: Schema.Types.ObjectId,
      refPath: "applicationModel",
      required: true,
      index: true,
    },
    applicationId: { type: String, required: true, trim: true, index: true },
    partner: {
      type: Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "PartnerProduct",
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: Object.values(PartnerAssignmentMode),
      required: true,
      default: PartnerAssignmentMode.MANUAL,
      index: true,
    },
    matchScore: { type: Number, min: 0, max: 100 },
    matchReasons: { type: [String], default: [] },
    matchChecks: { type: [matchCheckSchema], default: [] },
    status: {
      type: String,
      enum: Object.values(PartnerAssignmentStatus),
      required: true,
      default: PartnerAssignmentStatus.ASSIGNED,
      index: true,
    },
    externalApplicationId: { type: String, trim: true, default: "" },
    assignedAt: { type: Date, default: Date.now, required: true, index: true },
    sentAt: { type: Date },
    acceptedAt: { type: Date },
    rejectedAt: { type: Date },
    approvedAt: { type: Date },
    disbursedAt: { type: Date },
    policyIssuedAt: { type: Date },
    decisionAt: { type: Date, index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    auditHistory: { type: [auditSchema], default: [] },
  },
  { timestamps: true },
);

partnerAssignmentSchema.index(
  { applicationType: 1, application: 1, partner: 1, product: 1 },
  { unique: true },
);
partnerAssignmentSchema.index({ partner: 1, status: 1, assignedAt: -1 });
partnerAssignmentSchema.index({ applicationType: 1, status: 1, assignedAt: -1 });

export const PartnerAssignment = mongoose.model<IPartnerAssignment>(
  "PartnerAssignment",
  partnerAssignmentSchema,
);
