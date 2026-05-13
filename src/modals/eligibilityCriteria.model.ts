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
  salaryFoir0To25000?: number;
  salaryFoir25000To50000?: number;
  salaryFoir50000To75000?: number;
  salaryFoir75000Above?: number;
  businessFoir0To600000?: number;
  businessFoir600000To1000000?: number;
  businessFoir1000000Above?: number;
  itrFoir0To600000?: number;
  itrFoir600000To1000000?: number;
  itrFoir1000000Above?: number;
  btMultiplier0To1Year?: number;
  btMultiplier1To3Years?: number;
  btMultiplier3YearsAbove?: number;
  receiptMultiplier0To1Year?: number;
  receiptMultiplier1To3Years?: number;
  roi?: number;
  minAge?: number;
  maxAge?: number;
  maxTenureYears?: number;
  cashRental?: string;
  bankRental?: string;
  mixRental?: string;
  residentialCatALtv?: number;
  residentialCatBLtv?: number;
  residentialCatCLtv?: number;
  commercialCatALtv?: number;
  commercialCatBLtv?: number;
  commercialCatCLtv?: number;
  industrialCatALtv?: number;
  industrialCatBLtv?: number;
  industrialCatCLtv?: number;
  processingFees?: number;
  insurance?: string;
  loginFees?: string;
  companyCategory?: string;
  currentExperience?: number;
  totalExperience?: number;
  totalExperienceMonths?: number;
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
    salaryFoir0To25000: { type: Number },
    salaryFoir25000To50000: { type: Number },
    salaryFoir50000To75000: { type: Number },
    salaryFoir75000Above: { type: Number },
    businessFoir0To600000: { type: Number },
    businessFoir600000To1000000: { type: Number },
    businessFoir1000000Above: { type: Number },
    itrFoir0To600000: { type: Number },
    itrFoir600000To1000000: { type: Number },
    itrFoir1000000Above: { type: Number },
    btMultiplier0To1Year: { type: Number },
    btMultiplier1To3Years: { type: Number },
    btMultiplier3YearsAbove: { type: Number },
    receiptMultiplier0To1Year: { type: Number },
    receiptMultiplier1To3Years: { type: Number },
    roi: { type: Number },
    minAge: { type: Number },
    maxAge: { type: Number },
    maxTenureYears: { type: Number },
    cashRental: { type: String, trim: true },
    bankRental: { type: String, trim: true },
    mixRental: { type: String, trim: true },
    residentialCatALtv: { type: Number },
    residentialCatBLtv: { type: Number },
    residentialCatCLtv: { type: Number },
    commercialCatALtv: { type: Number },
    commercialCatBLtv: { type: Number },
    commercialCatCLtv: { type: Number },
    industrialCatALtv: { type: Number },
    industrialCatBLtv: { type: Number },
    industrialCatCLtv: { type: Number },
    processingFees: { type: Number },
    insurance: { type: String, trim: true },
    loginFees: { type: String, trim: true },
    companyCategory: { type: String, trim: true },
    currentExperience: { type: Number },
    totalExperience: { type: Number },
    totalExperienceMonths: { type: Number },
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
