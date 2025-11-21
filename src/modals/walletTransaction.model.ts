import mongoose, { Document, Schema } from "mongoose";

export type WalletTransactionType = "credit" | "debit";
export type WalletTransactionCategory =
  | "commission"
  | "adjustment"
  | "payout"
  | "subscription"
  | "refund";

export interface IWalletTransaction extends Document {
  agent: Schema.Types.ObjectId;
  amount: number;
  runningBalance: number;
  type: WalletTransactionType;
  category: WalletTransactionCategory;
  referenceId?: string;
  description?: string;
  metadata?: Record<string, any>;
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    agent: { type: Schema.Types.ObjectId, ref: "Agent", index: true },
    amount: { type: Number, required: true },
    runningBalance: { type: Number, required: true },
    type: { type: String, enum: ["credit", "debit"], required: true },
    category: {
      type: String,
      enum: ["commission", "adjustment", "payout", "subscription", "refund"],
      default: "commission",
    },
    referenceId: { type: String },
    description: { type: String },
    metadata: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
  },
  { timestamps: true }
);

WalletTransactionSchema.index({ agent: 1, createdAt: -1 });

const WalletTransaction = mongoose.model<IWalletTransaction>(
  "WalletTransaction",
  WalletTransactionSchema
);

export default WalletTransaction;
