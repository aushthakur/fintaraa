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
  itrWithFinancial?: string;
  itrYears?: number;
  gstProgram?: string;
  gstYears?: number;
  bankingYears?: number;
  rentalIncomeType?: string;
  businessProgramFresh?: string;
  gstAmount?: number;
  bankingAmount?: number;
  itrAmount?: number;
  nipPdBaseAmount?: number;
  btEmiMultiplier?: number;
  foirAsPerReceipts?: string;
  propertyCategory?: string;
  propertyType?: string;
  programs?: string[];
  cashProfit?: number;
  lowLtv?: number;
  bankingSurrogate?: string;
  companyListed?: string;
  companyCategory?: string;
  foir?: string;
  minimumVintage?: number;
  businessAge?: number;
  currentExperience?: number;
  totalExperience?: number;
  totalVintage?: number;
  currentVintage?: number;
  salaryAmount?: number;
  salaryMode?: string;
  salarySlip?: string;
  pfEsiDeduction?: string;
  form16Itr?: string;
  grossSalary?: number;
  netSalary?: number;
  currentTotalEmi?: number;
  netIncome?: number;
  netProfit?: number;
  cibilScoreWithCall?: number;
  cibilCriteria?: string;
  empAge?: string;
  loanTenure?: string;
  emiAmount?: number;
  loginFees?: number;
  processingFees?: number;
  legalValuation?: string;
  insurance?: string;
  businessType?: string;
  natureOfBusiness?: string;
  natureOfProfession?: string;
  gstTurnover?: number;
  receiptsAmount?: number;
  totalReceipts?: number;
  coApplicantType?: string;
  btBankName?: string;
  catAApproved?: boolean;
  catBSemiApproved?: boolean;
  catCUnapproved?: boolean;
  rateOfInterest?: string;
  averageBankBalance?: number;
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
    itrWithFinancial: { type: String, trim: true },
    itrYears: { type: Number },
    gstProgram: { type: String, trim: true },
    gstYears: { type: Number },
    bankingYears: { type: Number },
    rentalIncomeType: { type: String, trim: true },
    businessProgramFresh: { type: String, trim: true },
    gstAmount: { type: Number },
    bankingAmount: { type: Number },
    itrAmount: { type: Number },
    nipPdBaseAmount: { type: Number },
    btEmiMultiplier: { type: Number },
    foirAsPerReceipts: { type: String, trim: true },
    propertyCategory: { type: String, trim: true },
    propertyType: { type: String, trim: true },
    programs: [{ type: String, trim: true }],
    cashProfit: { type: Number },
    lowLtv: { type: Number },
    bankingSurrogate: { type: String, trim: true },
    companyListed: { type: String, trim: true },
    companyCategory: { type: String, trim: true },
    foir: { type: String, trim: true },
    minimumVintage: { type: Number },
    businessAge: { type: Number },
    currentExperience: { type: Number },
    totalExperience: { type: Number },
    totalVintage: { type: Number },
    currentVintage: { type: Number },
    salaryAmount: { type: Number },
    salaryMode: { type: String, trim: true },
    salarySlip: { type: String, trim: true },
    pfEsiDeduction: { type: String, trim: true },
    form16Itr: { type: String, trim: true },
    grossSalary: { type: Number },
    netSalary: { type: Number },
    currentTotalEmi: { type: Number },
    netIncome: { type: Number },
    netProfit: { type: Number },
    cibilScoreWithCall: { type: Number },
    cibilCriteria: { type: String, trim: true },
    empAge: { type: String, trim: true },
    loanTenure: { type: String, trim: true },
    emiAmount: { type: Number },
    loginFees: { type: Number },
    processingFees: { type: Number },
    legalValuation: { type: String, trim: true },
    insurance: { type: String, trim: true },
    businessType: { type: String, trim: true },
    natureOfBusiness: { type: String, trim: true },
    natureOfProfession: { type: String, trim: true },
    gstTurnover: { type: Number },
    receiptsAmount: { type: Number },
    totalReceipts: { type: Number },
    coApplicantType: { type: String, trim: true },
    btBankName: { type: String, trim: true },
    catAApproved: { type: Boolean },
    catBSemiApproved: { type: Boolean },
    catCUnapproved: { type: Boolean },
    rateOfInterest: { type: String, trim: true },
    averageBankBalance: { type: Number },
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
