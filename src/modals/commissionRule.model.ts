import mongoose, { Document, Schema } from "mongoose";
import { LoanProductType } from "./user.model";

export type CommissionRuleType = "flat" | "percentage" | "slab";

export interface ICommissionSlab {
  minAmount: number;
  maxAmount?: number;
  rate: number;
  rateType: "percentage" | "flat";
}

export interface ICommissionRule extends Document {
  name: string;
  description?: string;
  productType?: LoanProductType;
  geography?: {
    country?: string;
    state?: string;
    city?: string;
    pincode?: string;
  };
  leadTags?: string[];
  ruleType: CommissionRuleType;
  percentage?: number;
  flatAmount?: number;
  slabs?: ICommissionSlab[];
  priority: number;
  isActive: boolean;
  autoCredit: boolean;
  autoApproveThreshold?: number;
  minLoanAmount?: number;
  maxLoanAmount?: number;
  minCibil?: number;
  maxCibil?: number;
  createdAt: Date;
  updatedAt: Date;
}

const CommissionSlabSchema = new Schema<ICommissionSlab>(
  {
    minAmount: { type: Number, required: true },
    maxAmount: { type: Number },
    rate: { type: Number, required: true },
    rateType: {
      type: String,
      enum: ["percentage", "flat"],
      default: "percentage",
    },
  },
  { _id: false }
);

const CommissionRuleSchema = new Schema<ICommissionRule>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    productType: {
      type: String,
      enum: Object.values(LoanProductType),
    },
    geography: {
      country: String,
      state: String,
      city: String,
      pincode: String,
    },
    leadTags: { type: [String], default: [] },
    ruleType: {
      type: String,
      enum: ["flat", "percentage", "slab"],
      required: true,
      default: "percentage",
    },
    percentage: { type: Number, min: 0 },
    flatAmount: { type: Number, min: 0 },
    slabs: { type: [CommissionSlabSchema], default: [] },
    priority: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },
    autoCredit: { type: Boolean, default: true },
    autoApproveThreshold: { type: Number, default: 0 },
    minLoanAmount: { type: Number },
    maxLoanAmount: { type: Number },
    minCibil: { type: Number },
    maxCibil: { type: Number },
  },
  { timestamps: true }
);

CommissionRuleSchema.index({ productType: 1, isActive: 1, priority: 1 });
CommissionRuleSchema.index({ "geography.pincode": 1 });
CommissionRuleSchema.index({ leadTags: 1 });

const CommissionRule = mongoose.model<ICommissionRule>(
  "CommissionRule",
  CommissionRuleSchema
);

export default CommissionRule;
