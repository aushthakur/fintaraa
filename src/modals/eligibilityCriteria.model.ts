import mongoose, { Schema, Document } from "mongoose";

export enum EligibilityCriteriaStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export interface IEligibilityCriteria extends Document {
  loanType: string;
  bankName: string;
  salaryType: string;
  itrWithFinancial?: string;
  gstProgram?: string;
  selfEmp?: number;
  salaryEmp?: number;
  cashProfit?: number;
  lowTv?: number;
  bankAmount?: number;
  bankingSurrogate?: string;
  companyListed?: string;
  foir?: number;
  minimumVintage?: number;
  businessAge?: number;
  grossIncome?: number;
  currentExperience?: number;
  totalExperience?: number;
  salaryAmount?: number;
  currentTotalEmi?: number;
  netIncome?: number;
  cibilScoreWithCall?: number;
  catAApproved?: string;
  catBSemiApproved?: string;
  catCUnapproved?: string;
  propertyType?: string;
  empAge?: number;
  loanTenure?: number;
  rateOfInterest?: number;
  emiAmount?: number;
  loginFees?: number;
  processingFees?: number;
  legalValuation?: number;
  insurance?: number;
  rm?: string;
  rmMailId?: string;
  rmMbNo?: string;
  asm?: string;
  asmMailId?: string;
  asmMbNo?: string;
  zsm?: string;
  zsmMailId?: string;
  zsmMbNo?: string;
  status: EligibilityCriteriaStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const EligibilityCriteriaSchema = new Schema<IEligibilityCriteria>(
  {
    loanType: { type: String, trim: true, required: true },
    bankName: { type: String, trim: true, required: true },
    salaryType: { type: String, trim: true, required: true },
    itrWithFinancial: { type: String, trim: true },
    gstProgram: { type: String, trim: true },
    selfEmp: { type: Number },
    salaryEmp: { type: Number },
    cashProfit: { type: Number },
    lowTv: { type: Number },
    bankAmount: { type: Number },
    bankingSurrogate: { type: String, trim: true },
    companyListed: { type: String, trim: true },
    foir: { type: Number },
    minimumVintage: { type: Number },
    businessAge: { type: Number },
    grossIncome: { type: Number },
    currentExperience: { type: Number },
    totalExperience: { type: Number },
    salaryAmount: { type: Number },
    currentTotalEmi: { type: Number },
    netIncome: { type: Number },
    cibilScoreWithCall: { type: Number },
    catAApproved: { type: String, trim: true },
    catBSemiApproved: { type: String, trim: true },
    catCUnapproved: { type: String, trim: true },
    propertyType: { type: String, trim: true },
    empAge: { type: Number },
    loanTenure: { type: Number },
    rateOfInterest: { type: Number },
    emiAmount: { type: Number },
    loginFees: { type: Number },
    processingFees: { type: Number },
    legalValuation: { type: Number },
    insurance: { type: Number },
    rm: { type: String, trim: true },
    rmMailId: { type: String, trim: true },
    rmMbNo: { type: String, trim: true },
    asm: { type: String, trim: true },
    asmMailId: { type: String, trim: true },
    asmMbNo: { type: String, trim: true },
    zsm: { type: String, trim: true },
    zsmMailId: { type: String, trim: true },
    zsmMbNo: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(EligibilityCriteriaStatus),
      default: EligibilityCriteriaStatus.ACTIVE,
    },
  },
  { timestamps: true }
);

EligibilityCriteriaSchema.index({ loanType: 1, bankName: 1, salaryType: 1 });
EligibilityCriteriaSchema.index({ status: 1 });

export const EligibilityCriteria = mongoose.model<IEligibilityCriteria>(
  "EligibilityCriteria",
  EligibilityCriteriaSchema
);
