import mongoose, { Document, Schema, Types } from "mongoose";
import { LoanType } from "./loanquery.model";

export type AgencyCommissionCalculationType = "percentage" | "flat";

export interface IAgencyCommissionRule extends Document {
  agency?: Types.ObjectId;
  loanType: LoanType;
  calculationType: AgencyCommissionCalculationType;
  value: number;
  minLoanAmount?: number;
  maxLoanAmount?: number;
  capAmount?: number;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  priority: number;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgencyCommissionRuleSchema = new Schema<IAgencyCommissionRule>(
  {
    agency: { type: Schema.Types.ObjectId, ref: "Agency", index: true },
    loanType: {
      type: String,
      enum: Object.values(LoanType),
      required: true,
      index: true,
    },
    calculationType: {
      type: String,
      enum: ["percentage", "flat"],
      required: true,
    },
    value: { type: Number, required: true, min: 0 },
    minLoanAmount: { type: Number, min: 0 },
    maxLoanAmount: { type: Number, min: 0 },
    capAmount: { type: Number, min: 0 },
    effectiveFrom: { type: Date, index: true },
    effectiveTo: { type: Date, index: true },
    priority: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
);

AgencyCommissionRuleSchema.index({
  agency: 1,
  loanType: 1,
  isActive: 1,
  priority: -1,
  effectiveFrom: -1,
});

export const AgencyCommissionRule = mongoose.model<IAgencyCommissionRule>(
  "AgencyCommissionRule",
  AgencyCommissionRuleSchema,
);
