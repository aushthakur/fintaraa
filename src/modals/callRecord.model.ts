import mongoose, { Document, Schema, Types } from "mongoose";

export interface ICallRecord extends Document {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  age?: number;
  alternatePhone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  callStatus?: string;
  followUp?: boolean;
  productService?: string;
  loanAmount?: number;
  callbackAt?: Date;
  callbackNotifiedAt?: Date;
  leadStatus?: string;
  fatherName?: string;
  motherName?: string;
  leadBy?: string;
  extraField1?: string;
  extraField2?: string;
  dataSource?: string;
  recordingUrl?: string;
  emailSend?: boolean;
  createAccount?: boolean;
  comment?: string;
  contactActionStatus?: string;
  followUpNotes?: Array<{
    remark: string;
    addedBy?: Types.ObjectId;
    addedAt?: Date;
  }>;
  changeHistory?: Array<{
    summary?: string;
    diff?: Record<string, any>;
    changedBy?: Types.ObjectId;
    changedAt?: Date;
  }>;
  assignee?: Types.ObjectId;
  assignedBy?: Types.ObjectId;
  assignedAt?: Date;
  assignmentMode?: "auto" | "manual";
  channelAgency?: Types.ObjectId;
  attachedLead?: Types.ObjectId;
  channelMatchedAt?: Date;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const CallRecordSchema = new Schema<ICallRecord>(
  {
    phoneNumber: { type: String, required: true, trim: true, index: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    gender: { type: String, trim: true },
    age: { type: Number },
    alternatePhone: { type: String, trim: true },
    email: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    callStatus: { type: String, trim: true },
    followUp: { type: Boolean, default: false },
    productService: { type: String, trim: true },
    loanAmount: { type: Number },
    callbackAt: { type: Date },
    callbackNotifiedAt: { type: Date },
    leadStatus: { type: String, trim: true },
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    leadBy: { type: String, trim: true },
    extraField1: { type: String, trim: true },
    extraField2: { type: String, trim: true },
    dataSource: { type: String, trim: true },
    recordingUrl: { type: String, trim: true },
    emailSend: { type: Boolean, default: false },
    createAccount: { type: Boolean, default: false },
    comment: { type: String, trim: true },
    contactActionStatus: { type: String, trim: true },
    followUpNotes: {
      type: [
        {
          remark: { type: String, trim: true, required: true },
          addedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
          addedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    changeHistory: {
      type: [
        {
          summary: { type: String, trim: true },
          diff: { type: Schema.Types.Mixed },
          changedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    assignee: { type: Schema.Types.ObjectId, ref: "Agent" },
    assignedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    assignedAt: { type: Date },
    assignmentMode: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    channelAgency: { type: Schema.Types.ObjectId, ref: "Agency" },
    attachedLead: { type: Schema.Types.ObjectId, ref: "Lead" },
    channelMatchedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
);

CallRecordSchema.index({ phoneNumber: 1, createdAt: -1 });
CallRecordSchema.index({ assignee: 1, assignedAt: -1 });
CallRecordSchema.index({ channelAgency: 1, updatedAt: -1 });
CallRecordSchema.index({ attachedLead: 1, updatedAt: -1 });

export const CallRecord = mongoose.model<ICallRecord>(
  "CallRecord",
  CallRecordSchema,
);
