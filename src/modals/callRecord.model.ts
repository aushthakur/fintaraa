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
  monthlySalary?: number;
  panNumber?: string;
  employmentType?: string;
  businessType?: string;
  natureOfBusiness?: string;
  natureOfProfession?: string;
  gstTurnover?: number;
  totalReceipts?: number;
  coApplicantType?: string;
  totalVintage?: number;
  currentVintage?: number;
  btBankName?: string;
  disbursedAmount?: number;
  disbursedDate?: Date;
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
  createInquiry?: boolean;
  comment?: string;
  commentBy?: Types.ObjectId;
  commentedAt?: Date;
  contactActionStatus?: string;
  followUpHistory?: Array<{
    openedBy?: Types.ObjectId;
    closedBy?: Types.ObjectId;
    openedByName?: string;
    closedByName?: string;
    openedAt?: Date;
    closedAt?: Date;
    openingRemark?: string;
    closingRemark?: string;
    assignedTo?: Types.ObjectId;
    assignedToName?: string;
    callbackAt?: Date;
  }>;
  followUpNotes?: Array<{
    remark: string;
    addedBy?: Types.ObjectId;
    addedAt?: Date;
  }>;
  changeHistory?: Array<{
    summary?: string;
    diff?: Record<string, any>;
    changedBy?: Types.ObjectId;
    changedByName?: string;
    changedAt?: Date;
  }>;
  assignee?: Types.ObjectId;
  assignees?: Types.ObjectId[];
  assignedBy?: Types.ObjectId;
  assignedAt?: Date;
  assignmentMode?: "auto" | "manual";
  channelAgency?: Types.ObjectId;
  attachedLead?: Types.ObjectId;
  loanQueryId?: Types.ObjectId;
  loanQueryCreatedAt?: Date;
  insuranceQueryId?: Types.ObjectId;
  insuranceQueryCreatedAt?: Date;
  supportTicketId?: Types.ObjectId;
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
    monthlySalary: { type: Number },
    panNumber: { type: String, trim: true, uppercase: true },
    employmentType: { type: String, trim: true },
    businessType: { type: String, trim: true },
    natureOfBusiness: { type: String, trim: true },
    natureOfProfession: { type: String, trim: true },
    gstTurnover: { type: Number },
    totalReceipts: { type: Number },
    coApplicantType: { type: String, trim: true },
    totalVintage: { type: Number },
    currentVintage: { type: Number },
    btBankName: { type: String, trim: true },
    disbursedAmount: { type: Number },
    disbursedDate: { type: Date },
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
    createInquiry: { type: Boolean, default: false },
    comment: { type: String, trim: true },
    commentBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    commentedAt: { type: Date },
    contactActionStatus: { type: String, trim: true },
    followUpHistory: {
      type: [
        {
          openedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
          closedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
          openedByName: { type: String, trim: true },
          closedByName: { type: String, trim: true },
          openedAt: { type: Date, default: Date.now },
          closedAt: { type: Date },
          openingRemark: { type: String, trim: true },
          closingRemark: { type: String, trim: true },
          assignedTo: { type: Schema.Types.ObjectId, ref: "Admin" },
          assignedToName: { type: String, trim: true },
          callbackAt: { type: Date },
        },
      ],
      default: [],
    },
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
          changedByName: { type: String, trim: true },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    assignee: { type: Schema.Types.ObjectId, ref: "Admin" },
    assignees: [{ type: Schema.Types.ObjectId, ref: "Admin" }],
    assignedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    assignedAt: { type: Date },
    assignmentMode: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    attachedLead: { type: Schema.Types.ObjectId, ref: "Lead" },
    channelAgency: { type: Schema.Types.ObjectId, ref: "Agency" },
    loanQueryId: { type: Schema.Types.ObjectId, ref: "LoanQuery" },
    loanQueryCreatedAt: { type: Date },
    insuranceQueryId: { type: Schema.Types.ObjectId, ref: "InsuranceQuery" },
    insuranceQueryCreatedAt: { type: Date },
    supportTicketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
    channelMatchedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
);

CallRecordSchema.index({ assignee: 1, assignedAt: -1 });
CallRecordSchema.index({ assignees: 1, assignedAt: -1 });
CallRecordSchema.index({ phoneNumber: 1, createdAt: -1 });
CallRecordSchema.index({ attachedLead: 1, updatedAt: -1 });
CallRecordSchema.index({ channelAgency: 1, updatedAt: -1 });
CallRecordSchema.index({ loanQueryId: 1, updatedAt: -1 });
CallRecordSchema.index({ supportTicketId: 1 }, { unique: true, sparse: true });

export const CallRecord = mongoose.model<ICallRecord>(
  "CallRecord",
  CallRecordSchema,
);
