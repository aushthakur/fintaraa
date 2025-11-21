import mongoose, { Document, Schema, Types } from "mongoose";
import { LoanProductType } from "./user.model";

export enum LeadStatus {
  NEW = "new",
  CONTACTED = "contacted",
  IN_PROGRESS = "in_progress",
  CONVERTED = "converted",
  CLOSED = "closed",
}

export enum LeadPriority {
  VIP = "vip",
  HOT = "hot",
  WARM = "warm",
  COLD = "cold",
}

export enum LeadActivityType {
  CREATED = "created",
  UPDATED = "updated",
  NOTE_ADDED = "note_added",
  FOLLOW_UP_ADDED = "follow_up_added",
  FOLLOW_UP_COMPLETED = "follow_up_completed",
  STATUS_CHANGED = "status_changed",
  ASSIGNED = "assigned",
  ESCALATED = "escalated",
  INTEGRATION_EVENT = "integration_event",
  CONVERTED = "converted",
}

export enum LeadConnectorType {
  META_ADS = "meta_ads",
  GOOGLE_ADS = "google_ads",
  LANDING_PAGE = "landing_page",
  AFFILIATE = "affiliate",
  ZAPIER = "zapier",
  MANUAL = "manual",
}

export enum LeadFollowUpStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  SKIPPED = "skipped",
}

export enum LeadEscalationLevel {
  LEVEL_1 = "l1",
  LEVEL_2 = "l2",
  LEVEL_3 = "l3",
}

export interface ILeadAssignment {
  agent: Types.ObjectId;
  assignedAt: Date;
  assignedBy?: Types.ObjectId;
  mode: "auto" | "manual" | "reassign";
  reason?: string;
  geography?: string;
  productCategory?: LoanProductType;
  workloadSnapshot?: {
    capacity?: number;
    activeLeads?: number;
  };
  priorityScore?: number;
}

export interface ILeadNote {
  content: string;
  visibility: "internal" | "agent" | "public";
  channel?: string;
  attachments?: string[];
  addedAt: Date;
  addedBy: Types.ObjectId;
  addedByModel: "Admin" | "Agent" | "User";
}

export interface ILeadFollowUp {
  dueAt: Date;
  channel: string;
  reminderAt?: Date;
  status: LeadFollowUpStatus;
  addedBy: Types.ObjectId;
  addedByModel: "Admin" | "Agent";
  notes?: string;
  outcome?: string;
  completedAt?: Date;
}

export interface ILeadActivity {
  type: LeadActivityType;
  description?: string;
  actor?: Types.ObjectId;
  actorModel?: "Admin" | "Agent" | "User";
  payload?: Record<string, any>;
  createdAt: Date;
}

export interface ILeadIntegrationEvent {
  provider: LeadConnectorType | string;
  status: "received" | "processed" | "failed";
  externalId?: string;
  payload: Record<string, any>;
  receivedAt: Date;
  processedAt?: Date;
  message?: string;
}

export interface ILeadEscalation {
  level: LeadEscalationLevel;
  reason: string;
  owner?: Types.ObjectId;
  triggeredAt: Date;
  resolvedAt?: Date;
  slaBreachInHours?: number;
  resolutionNotes?: string;
}

export interface ILead extends Document {
  fullName: string;
  email?: string;
  mobile: string;
  whatsappOptIn?: boolean;
  status: LeadStatus;
  priority: LeadPriority;
  intentScore?: number;
  productType?: LoanProductType;
  loanAmount?: number;
  loanPurpose?: string;
  cibilScore?: number;
  location?: {
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  capturedFrom: {
    platform: LeadConnectorType | string;
    channel?: string;
    campaignId?: string;
    adGroupId?: string;
    adId?: string;
    affiliateId?: string;
    landingPage?: string;
    medium?: string;
  };
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  metadata?: Record<string, any>;
  tags: string[];
  assignment: {
    current?: ILeadAssignment;
    history: ILeadAssignment[];
  };
  notes: ILeadNote[];
  followUps: ILeadFollowUp[];
  activities: ILeadActivity[];
  integrationEvents: ILeadIntegrationEvent[];
  escalation?: ILeadEscalation;
  borrowerProfile?: Types.ObjectId;
  duplicateOf?: Types.ObjectId;
  duplicates: Types.ObjectId[];
  lastContactedAt?: Date;
  nextActionAt?: Date;
  slaBreachAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LeadAssignmentSchema = new Schema<ILeadAssignment>(
  {
    agent: { type: Schema.Types.ObjectId, ref: "Agent" },
    assignedAt: { type: Date, default: Date.now },
    assignedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    mode: {
      type: String,
      enum: ["auto", "manual", "reassign"],
      default: "auto",
    },
    reason: { type: String, trim: true },
    geography: { type: String },
    productCategory: {
      type: String,
      enum: Object.values(LoanProductType),
    },
    workloadSnapshot: {
      capacity: Number,
      activeLeads: Number,
    },
    priorityScore: Number,
  },
  { _id: false }
);

const LeadNoteSchema = new Schema<ILeadNote>(
  {
    content: { type: String, required: true, trim: true },
    visibility: {
      type: String,
      enum: ["internal", "agent", "public"],
      default: "internal",
    },
    channel: { type: String, default: "crm" },
    attachments: [{ type: String }],
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, required: true },
    addedByModel: {
      type: String,
      enum: ["Admin", "Agent", "User"],
      default: "Admin",
    },
  },
  { _id: false }
);

const LeadFollowUpSchema = new Schema<ILeadFollowUp>(
  {
    dueAt: { type: Date, required: true },
    channel: { type: String, default: "call" },
    reminderAt: { type: Date },
    status: {
      type: String,
      enum: Object.values(LeadFollowUpStatus),
      default: LeadFollowUpStatus.PENDING,
    },
    addedBy: { type: Schema.Types.ObjectId, required: true },
    addedByModel: {
      type: String,
      enum: ["Admin", "Agent"],
      default: "Admin",
    },
    notes: { type: String },
    outcome: { type: String },
    completedAt: { type: Date },
  },
  { _id: false, timestamps: true }
);

const LeadActivitySchema = new Schema<ILeadActivity>(
  {
    type: {
      type: String,
      enum: Object.values(LeadActivityType),
      required: true,
    },
    description: { type: String },
    actor: { type: Schema.Types.ObjectId },
    actorModel: {
      type: String,
      enum: ["Admin", "Agent", "User"],
    },
    payload: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const LeadIntegrationEventSchema = new Schema<ILeadIntegrationEvent>(
  {
    provider: { type: String, required: true },
    status: {
      type: String,
      enum: ["received", "processed", "failed"],
      default: "received",
    },
    externalId: { type: String },
    payload: { type: Schema.Types.Mixed },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    message: { type: String },
  },
  { _id: false }
);

const LeadEscalationSchema = new Schema<ILeadEscalation>(
  {
    level: {
      type: String,
      enum: Object.values(LeadEscalationLevel),
      required: true,
    },
    reason: { type: String, required: true },
    owner: { type: Schema.Types.ObjectId, ref: "Admin" },
    triggeredAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    slaBreachInHours: { type: Number },
    resolutionNotes: { type: String },
  },
  { _id: false }
);

const LeadSchema = new Schema<ILead>(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    mobile: { type: String, required: true, trim: true, index: true },
    whatsappOptIn: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(LeadStatus),
      default: LeadStatus.NEW,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(LeadPriority),
      default: LeadPriority.WARM,
      index: true,
    },
    intentScore: { type: Number, default: 50 },
    productType: {
      type: String,
      enum: Object.values(LoanProductType),
    },
    loanAmount: { type: Number },
    loanPurpose: { type: String },
    cibilScore: { type: Number },
    location: {
      city: { type: String },
      state: { type: String },
      pincode: { type: String, index: true },
      country: { type: String },
    },
    capturedFrom: {
      platform: {
        type: String,
        enum: Object.values(LeadConnectorType),
        required: true,
      },
      channel: { type: String, default: "manual" },
      campaignId: { type: String },
      adGroupId: { type: String },
      adId: { type: String },
      affiliateId: { type: String },
      landingPage: { type: String },
      medium: { type: String },
    },
    utm: {
      source: { type: String },
      medium: { type: String },
      campaign: { type: String },
      term: { type: String },
      content: { type: String },
    },
    metadata: { type: Schema.Types.Mixed },
    tags: { type: [String], default: [] },
    assignment: {
      current: { type: LeadAssignmentSchema, default: undefined },
      history: { type: [LeadAssignmentSchema], default: [] },
    },
    notes: { type: [LeadNoteSchema], default: [] },
    followUps: { type: [LeadFollowUpSchema], default: [] },
    activities: { type: [LeadActivitySchema], default: [] },
    integrationEvents: { type: [LeadIntegrationEventSchema], default: [] },
    escalation: { type: LeadEscalationSchema, default: undefined },
    borrowerProfile: { type: Schema.Types.ObjectId, ref: "User" },
    duplicateOf: { type: Schema.Types.ObjectId, ref: "Lead" },
    duplicates: {
      type: [{ type: Schema.Types.ObjectId, ref: "Lead" }],
      default: [],
    },
    lastContactedAt: { type: Date },
    nextActionAt: { type: Date },
    slaBreachAt: { type: Date },
  },
  { timestamps: true }
);

LeadSchema.index({ email: 1 }, { sparse: true });
LeadSchema.index({ status: 1, priority: 1, productType: 1 });
LeadSchema.index({ "capturedFrom.platform": 1, createdAt: -1 });

const Lead = mongoose.model<ILead>("Lead", LeadSchema);

export default Lead;
