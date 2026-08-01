import { LoanType } from "./loanquery.model";
import { InsuranceType } from "./insurancequery.model";
import mongoose, { Document, Schema, Types } from "mongoose";

export type AgencyCommissionQueryType = "loan" | "insurance";
export type AgencyCommissionEarningStatus =
  | "pending"
  | "earned"
  | "paid"
  | "reversed"
  | "clawback_required";

export interface IAgencyCommissionTransaction extends Document {
  isCanonical?: boolean;
  ownerAgency: Types.ObjectId;
  sourceAgency?: Types.ObjectId;
  queryType: AgencyCommissionQueryType;
  queryRef: Types.ObjectId;
  customerId?: Types.ObjectId;
  customerName?: string;
  loanType?: LoanType;
  insuranceType?: InsuranceType;
  productType?: string;
  disbursedAmount: number;
  commissionAmount: number;
  paidAmount?: number;
  eligibilityCriteriaId?: Types.ObjectId;
  eligibilityMatched?: boolean;
  eligibilityKey?: string;
  commissionRuleId?: Types.ObjectId;
  commissionRuleSnapshot?: Record<string, any>;
  accrualStage?: "approved" | "disbursed";
  earningStatus: AgencyCommissionEarningStatus;
  disbursedAt?: Date;
  paidAt?: Date;
  paidBy?: Types.ObjectId;
  paymentReference?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const AgencyCommissionTransactionSchema =
  new Schema<IAgencyCommissionTransaction>(
    {
      isCanonical: { type: Boolean, default: true, index: true },
      ownerAgency: {
        type: Schema.Types.ObjectId,
        ref: "Agency",
        required: true,
        index: true,
      },
      sourceAgency: { type: Schema.Types.ObjectId, ref: "Agency", index: true },
      queryType: {
        type: String,
        enum: ["loan", "insurance"],
        required: true,
        index: true,
      },
      queryRef: { type: Schema.Types.ObjectId, required: true, index: true },
      customerId: { type: Schema.Types.ObjectId, index: true },
      customerName: { type: String, trim: true },
      loanType: { type: String, enum: Object.values(LoanType) },
      insuranceType: { type: String, enum: Object.values(InsuranceType) },
      productType: { type: String, trim: true },
      disbursedAmount: { type: Number, required: true, default: 0 },
      commissionAmount: { type: Number, required: true, default: 0 },
      paidAmount: { type: Number, default: 0, min: 0 },
      eligibilityCriteriaId: {
        type: Schema.Types.ObjectId,
        ref: "EligibilityCriteria",
      },
      eligibilityMatched: { type: Boolean, default: false },
      eligibilityKey: { type: String, trim: true },
      commissionRuleId: {
        type: Schema.Types.ObjectId,
        ref: "AgencyCommissionRule",
        index: true,
      },
      commissionRuleSnapshot: { type: Schema.Types.Mixed },
      accrualStage: {
        type: String,
        enum: ["approved", "disbursed"],
        default: "disbursed",
        index: true,
      },
      earningStatus: {
        type: String,
        enum: ["pending", "earned", "paid", "reversed", "clawback_required"],
        default: "earned",
        index: true,
      },
      disbursedAt: { type: Date, index: true },
      paidAt: { type: Date },
      paidBy: { type: Schema.Types.ObjectId, ref: "Admin" },
      paymentReference: { type: String, trim: true },
      notes: { type: String, trim: true },
      metadata: { type: Schema.Types.Mixed },
    },
    { timestamps: true },
  );

AgencyCommissionTransactionSchema.index(
  { queryType: 1, queryRef: 1 },
  {
    unique: true,
    partialFilterExpression: { isCanonical: true },
    name: "canonical_query_unique_commission",
  },
);
AgencyCommissionTransactionSchema.index({
  ownerAgency: 1,
  earningStatus: 1,
  createdAt: -1,
});

export const AgencyCommissionTransaction =
  mongoose.model<IAgencyCommissionTransaction>(
    "AgencyCommissionTransaction",
    AgencyCommissionTransactionSchema,
  );
