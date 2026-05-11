import { LoanType } from "./loanquery.model";
import { InsuranceType } from "./insurancequery.model";
import mongoose, { Document, Schema, Types } from "mongoose";

export interface IEligibilityMailPermission extends Document {
  status: boolean;
  agent: Types.ObjectId;
  loanTypes: LoanType[];
  allowAllLoanTypes: boolean;
  insuranceTypes: InsuranceType[];
  allowAllInsuranceTypes: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const eligibilityMailPermissionSchema = new Schema<IEligibilityMailPermission>(
  {
    agent: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      unique: true,
      index: true,
    },
    loanTypes: [
      {
        type: String,
        enum: Object.values(LoanType),
        default: [],
      },
    ],
    insuranceTypes: [
      {
        type: String,
        enum: Object.values(InsuranceType),
        default: [],
      },
    ],
    allowAllLoanTypes: {
      type: Boolean,
      default: false,
    },
    allowAllInsuranceTypes: {
      type: Boolean,
      default: false,
    },
    status: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true },
);

eligibilityMailPermissionSchema.index({ status: 1, agent: 1 });

export const EligibilityMailPermission =
  mongoose.model<IEligibilityMailPermission>(
    "EligibilityMailPermission",
    eligibilityMailPermissionSchema,
  );
