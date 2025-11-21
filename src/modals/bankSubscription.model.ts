import mongoose, { Document, Schema } from "mongoose";

export type BillingModel = "subscription" | "pay_per_lead";

export interface IBillingHistory {
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  referenceId?: string;
  chargedAt?: Date;
  notes?: Record<string, any>;
}

export interface IBankSubscription extends Document {
  bankName: string;
  contactEmail: string;
  billingModel: BillingModel;
  amount: number;
  currency: string;
  billingCycle: "monthly" | "quarterly" | "yearly" | "per_lead";
  nextBillingDate?: Date;
  razorpayCustomerId?: string;
  autopayTokenId?: string;
  leadsIncluded?: number;
  leadsConsumed?: number;
  status: "active" | "inactive" | "trial";
  billingHistory: IBillingHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const BillingHistorySchema = new Schema<IBillingHistory>(
  {
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    referenceId: { type: String },
    chargedAt: { type: Date },
    notes: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const BankSubscriptionSchema = new Schema<IBankSubscription>(
  {
    bankName: { type: String, required: true, trim: true },
    contactEmail: { type: String, required: true, lowercase: true },
    billingModel: {
      type: String,
      enum: ["subscription", "pay_per_lead"],
      default: "subscription",
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", "per_lead"],
      default: "monthly",
    },
    nextBillingDate: { type: Date },
    razorpayCustomerId: { type: String },
    autopayTokenId: { type: String },
    leadsIncluded: { type: Number },
    leadsConsumed: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "inactive", "trial"],
      default: "trial",
    },
    billingHistory: { type: [BillingHistorySchema], default: [] },
  },
  { timestamps: true }
);

BankSubscriptionSchema.index({ bankName: 1, billingModel: 1 });

const BankSubscription = mongoose.model<IBankSubscription>(
  "BankSubscription",
  BankSubscriptionSchema
);

export default BankSubscription;
