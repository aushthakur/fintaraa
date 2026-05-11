import mongoose, { Schema, Document } from "mongoose";

export enum EligibilityCriteriaStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum EligibilityCommissionType {
  PERCENTAGE = "percentage",
  FLAT = "flat",
}

export interface IEligibilityCriteria extends Document {
  loanType: string;
  bankName: string;
  salaryType: string;
  commissionType?: EligibilityCommissionType;
  commissionValue?: number;
  commissionMinAmount?: number;
  commissionMaxAmount?: number;
  commissionCapAmount?: number;
  cibilScore?: number;
  itrYears?: number;
  businessProgramFresh?: string;
  gstAmount?: number;
  bankingAmount?: number;
  itrAmount?: number;
  nipPdBase?: number;
  lowLtv?: number;
  companyCategory?: string;
  currentExperience?: number;
  totalExperience?: number;
  totalVintage?: number;
  currentVintage?: number;
  netSalary?: number;
  currentTotalEmi?: number;
  receiptsAmount?: number;
  rm?: string;
  rmMailId?: string;
  rmMbNo?: string;
  asm?: string;
  asmMailId?: string;
  asmMbNo?: string;
  zsm?: string;
  zsmMailId?: string;
  zsmMbNo?: string;
  remarks?: string;
  status: EligibilityCriteriaStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const EligibilityCriteriaSchema = new Schema<IEligibilityCriteria>(
  {
    loanType: { type: String, trim: true, required: true },
    bankName: { type: String, trim: true, required: true },
    salaryType: { type: String, trim: true, required: true },
    commissionType: {
      type: String,
      enum: Object.values(EligibilityCommissionType),
      default: EligibilityCommissionType.PERCENTAGE,
    },
    commissionValue: { type: Number, default: 0 },
    commissionMinAmount: { type: Number },
    commissionMaxAmount: { type: Number },
    commissionCapAmount: { type: Number },
    cibilScore: { type: Number },
    itrYears: { type: Number },
    businessProgramFresh: { type: String, trim: true },
    gstAmount: { type: Number },
    bankingAmount: { type: Number },
    itrAmount: { type: Number },
    nipPdBase: { type: Number },
    lowLtv: { type: Number },
    companyCategory: { type: String, trim: true },
    currentExperience: { type: Number },
    totalExperience: { type: Number },
    totalVintage: { type: Number },
    currentVintage: { type: Number },
    netSalary: { type: Number },
    currentTotalEmi: { type: Number },
    receiptsAmount: { type: Number },
    rm: { type: String, trim: true },
    rmMailId: { type: String, trim: true },
    rmMbNo: { type: String, trim: true },
    asm: { type: String, trim: true },
    asmMailId: { type: String, trim: true },
    asmMbNo: { type: String, trim: true },
    zsm: { type: String, trim: true },
    zsmMailId: { type: String, trim: true },
    zsmMbNo: { type: String, trim: true },
    remarks: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(EligibilityCriteriaStatus),
      default: EligibilityCriteriaStatus.ACTIVE,
    },
  },
  { timestamps: true },
);

EligibilityCriteriaSchema.index({ loanType: 1, bankName: 1, salaryType: 1 });
EligibilityCriteriaSchema.index({ status: 1 });

export const EligibilityCriteria = mongoose.model<IEligibilityCriteria>(
  "EligibilityCriteria",
  EligibilityCriteriaSchema,
);
