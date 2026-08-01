import mongoose, { Document, Schema, Types } from "mongoose";

export type AgencyPayoutMethod = "upi" | "bank_transfer";
export type AgencyPayoutStatus =
  | "pending"
  | "approved"
  | "processing"
  | "paid"
  | "failed"
  | "rejected";

interface IAgencyPayoutBankDetails {
  accountNumber?: string;
  ifsc?: string;
  accountHolder?: string;
  bankName?: string;
}

export interface IAgencyPayoutRequest extends Document {
  ownerAgency: Types.ObjectId;
  requestedBy: Types.ObjectId;
  payoutProfile?: Types.ObjectId;
  destinationEncryptedSnapshot?: string;
  destinationMasked?: string;
  commissionTransactions?: Types.ObjectId[];
  payoutAllocations?: Array<{ transaction: Types.ObjectId; amount: number }>;
  reservationActive?: boolean;
  amount: number;
  method: AgencyPayoutMethod;
  upiId?: string;
  bankDetails?: IAgencyPayoutBankDetails;
  status: AgencyPayoutStatus;
  paymentReference?: string;
  notes?: string;
  failureReason?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  processedAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgencyPayoutRequestSchema = new Schema<IAgencyPayoutRequest>(
  {
    ownerAgency: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      required: true,
      index: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      required: true,
      index: true,
    },
    payoutProfile: { type: Schema.Types.ObjectId, ref: "AgencyPayoutProfile" },
    destinationEncryptedSnapshot: { type: String, select: false },
    destinationMasked: { type: String, trim: true },
    commissionTransactions: [
      { type: Schema.Types.ObjectId, ref: "AgencyCommissionTransaction" },
    ],
    payoutAllocations: [
      {
        transaction: {
          type: Schema.Types.ObjectId,
          ref: "AgencyCommissionTransaction",
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],
    reservationActive: { type: Boolean, default: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ["upi", "bank_transfer"],
      required: true,
    },
    upiId: { type: String, trim: true },
    bankDetails: {
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true },
      accountHolder: { type: String, trim: true },
      bankName: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ["pending", "approved", "processing", "paid", "failed", "rejected"],
      default: "pending",
      index: true,
    },
    paymentReference: { type: String, trim: true },
    notes: { type: String, trim: true },
    failureReason: { type: String, trim: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    approvedAt: { type: Date },
    processedAt: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

AgencyPayoutRequestSchema.index({ ownerAgency: 1, status: 1, createdAt: -1 });
AgencyPayoutRequestSchema.index(
  { ownerAgency: 1, reservationActive: 1 },
  {
    unique: true,
    partialFilterExpression: { reservationActive: true },
    name: "one_active_agency_payout",
  },
);

export const AgencyPayoutRequest = mongoose.model<IAgencyPayoutRequest>(
  "AgencyPayoutRequest",
  AgencyPayoutRequestSchema,
);
