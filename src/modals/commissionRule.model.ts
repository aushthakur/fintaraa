import mongoose, { Document, Schema } from "mongoose";
import { LoanProductType } from "./user.model";
import { InsuranceType } from "./insurancequery.model";

export type CommissionRuleType = "flat" | "percentage" | "slab";

// Unified product type for both loans and insurance
export type ProductType = LoanProductType | InsuranceType;

export interface ICommissionSlab {
  minAmount: number;
  maxAmount?: number;
  rate: number;
  rateType: "percentage" | "flat";
}

export interface ICommissionRule extends Document {
  name: string;
  description?: string;
  productType?: ProductType;
  queryType?: "loan" | "insurance"; // Type of query (loan or insurance)
  geography?: {
    country?: string;
    state?: string;
    city?: string;
    pincode?: string;
  };
  tags?: string[]; // Tags to match against query tags
  ruleType: CommissionRuleType;
  percentage?: number;
  flatAmount?: number;
  slabs?: ICommissionSlab[];
  priority: number;
  isActive: boolean;
  autoCredit: boolean;
  autoApproveThreshold?: number;
  minAmount?: number; // Generic amount field (for both loans and insurance)
  maxAmount?: number; // Generic amount field (for both loans and insurance)
  minCibil?: number;
  maxCibil?: number;
  // Backward compatibility fields (deprecated, use minAmount/maxAmount instead)
  minLoanAmount?: number;
  maxLoanAmount?: number;
  leadType?: "loan" | "insurance"; // Deprecated: use queryType
  leadTags?: string[]; // Deprecated: use tags
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
      enum: [...Object.values(LoanProductType), ...Object.values(InsuranceType)],
    },
    queryType: {
      type: String,
      enum: ["loan", "insurance"],
    },
    geography: {
      country: String,
      state: String,
      city: String,
      pincode: String,
    },
    tags: { type: [String], default: [] },
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
    minAmount: { type: Number },
    maxAmount: { type: Number },
    minCibil: { type: Number },
    maxCibil: { type: Number },
    // Keep old field names for backward compatibility
    minLoanAmount: { type: Number },
    maxLoanAmount: { type: Number },
    leadType: { type: String, enum: ["loan", "insurance"] }, // Deprecated: use queryType
    leadTags: { type: [String], default: [] }, // Deprecated: use tags
  },
  { timestamps: true }
);

CommissionRuleSchema.index({ productType: 1, isActive: 1, priority: 1 });
CommissionRuleSchema.index({ queryType: 1, isActive: 1 });
CommissionRuleSchema.index({ "geography.pincode": 1 });
CommissionRuleSchema.index({ tags: 1 });
// Backward compatibility indexes
CommissionRuleSchema.index({ leadTags: 1 });

const CommissionRule = mongoose.model<ICommissionRule>(
  "CommissionRule",
  CommissionRuleSchema
);

export default CommissionRule;
