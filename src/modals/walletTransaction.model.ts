import mongoose, { Document, Schema } from "mongoose";

export type WalletTransactionType = "credit" | "debit";
export type WalletTransactionCategory =
  | "commission"
  | "adjustment"
  | "payout"
  | "subscription"
  | "refund";

export interface IWalletTransaction extends Document {
  lander: Schema.Types.ObjectId;
  agency?: Schema.Types.ObjectId; // Agency association for agency-wise filtering
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
    lander: { type: Schema.Types.ObjectId, ref: "Lander", index: true },
    agency: { type: Schema.Types.ObjectId, ref: "Agency", index: true }, // Agency association
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
      default: "pending",
    },
  },
  { timestamps: true },
);

WalletTransactionSchema.index({ lander: 1, createdAt: -1 });

const WalletTransaction = mongoose.model<IWalletTransaction>(
  "WalletTransaction",
  WalletTransactionSchema,
);

export default WalletTransaction;
