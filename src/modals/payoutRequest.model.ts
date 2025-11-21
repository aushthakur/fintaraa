import mongoose, { Document, Schema } from "mongoose";

export type PayoutMethod = "upi" | "bank_transfer" | "wallet";
export type PayoutStatus =
  | "pending"
  | "approved"
  | "processing"
  | "paid"
  | "rejected"
  | "failed";

export interface IPayoutRequest extends Document {
  agent: Schema.Types.ObjectId;
  amount: number;
  method: PayoutMethod;
  upiId?: string;
  bankDetails?: {
    accountHolder?: string;
    accountNumber?: string;
    ifsc?: string;
    bankName?: string;
  };
  razorpayContactId?: string;
  razorpayFundAccountId?: string;
  razorpayPayoutId?: string;
  status: PayoutStatus;
  approvedBy?: Schema.Types.ObjectId;
  approvedAt?: Date;
  processedAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PayoutRequestSchema = new Schema<IPayoutRequest>(
  {
    agent: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    amount: { type: Number, required: true },
    method: {
      type: String,
      enum: ["upi", "bank_transfer", "wallet"],
      default: "upi",
    },
    upiId: { type: String },
    bankDetails: {
      accountHolder: String,
      accountNumber: String,
      ifsc: String,
      bankName: String,
    },
    razorpayContactId: { type: String },
    razorpayFundAccountId: { type: String },
    razorpayPayoutId: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "processing", "paid", "rejected", "failed"],
      default: "pending",
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    approvedAt: { type: Date },
    processedAt: { type: Date },
    failureReason: { type: String },
  },
  { timestamps: true }
);

PayoutRequestSchema.index({ agent: 1, status: 1 });

const PayoutRequest = mongoose.model<IPayoutRequest>(
  "PayoutRequest",
  PayoutRequestSchema
);

export default PayoutRequest;
