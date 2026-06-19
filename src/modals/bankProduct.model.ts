import mongoose, { Document, Schema } from "mongoose";

export enum BankProductStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum CardNetwork {
  VISA = "Visa",
  AMEX = "Amex",
  RUPAY = "RuPay",
  OTHER = "Other",
  DINERS = "Diners",
  MASTERCARD = "Mastercard",
  MASTERCARD_LEGACY = "Masstercard",
}

export type BankProductFaq = {
  question: string;
  answer: string;
};

export interface IBankProduct extends Document {
  name: string;
  type: string;
  link: string;
  title: string;
  image: string;
  bankName: string;
  rank?: number;
  subtitle?: string;
  shortDescription?: string;
  annualFee?: number;
  joiningFee?: number;
  cardType?: string;
  rewardsType?: string;
  annualFeeBucket?: string;
  incomeRequirementBucket?: string;
  welcomeBenefits?: string;
  rewardStructure?: string;
  cashbackDetails?: string;
  loungeAccess?: string;
  loungeAccessAvailable?: boolean;
  fuelBenefits?: string;
  movieBenefits?: string;
  travelBenefits?: string;
  insuranceBenefits?: string;
  eligibilityCriteria?: string[];
  minimumIncome?: number;
  creditScoreRequirement?: number;
  processingTime?: string;
  featuresList?: string[];
  faqs?: BankProductFaq[];
  applyUrl?: string;
  featured?: boolean;
  priorityOrder?: number;
  applyClickCount?: number;
  detailViewCount?: number;
  termsAndConditions: string[];
  eligibilityTermsAndConditions: string[];
  cardNetwork?: CardNetwork;
  status: BankProductStatus;
  createdAt: Date;
  updatedAt: Date;
}

const bankProductSchema = new Schema<IBankProduct>(
  {
    subtitle: { type: String, trim: true },
    image: { type: String, required: true },
    shortDescription: { type: String, trim: true },
    link: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    annualFee: { type: Number, default: 0, index: true },
    joiningFee: { type: Number, default: 0 },
    cardType: { type: String, trim: true, index: true },
    rewardsType: { type: String, trim: true, index: true },
    annualFeeBucket: { type: String, trim: true, index: true },
    incomeRequirementBucket: { type: String, trim: true, index: true },
    welcomeBenefits: { type: String, trim: true },
    rewardStructure: { type: String, trim: true },
    cashbackDetails: { type: String, trim: true },
    loungeAccess: { type: String, trim: true },
    loungeAccessAvailable: { type: Boolean, default: false, index: true },
    fuelBenefits: { type: String, trim: true },
    movieBenefits: { type: String, trim: true },
    travelBenefits: { type: String, trim: true },
    insuranceBenefits: { type: String, trim: true },
    eligibilityCriteria: { type: [String], default: [] },
    minimumIncome: { type: Number, default: 0, index: true },
    creditScoreRequirement: { type: Number, default: 700, index: true },
    processingTime: { type: String, trim: true },
    featuresList: { type: [String], default: [] },
    faqs: {
      type: [
        {
          question: { type: String, trim: true },
          answer: { type: String, trim: true },
        },
      ],
      default: [],
    },
    applyUrl: { type: String, trim: true },
    featured: { type: Boolean, default: false, index: true },
    priorityOrder: { type: Number, default: 9999, index: true },
    applyClickCount: { type: Number, default: 0 },
    detailViewCount: { type: Number, default: 0 },
    termsAndConditions: { type: [String], default: [] },
    eligibilityTermsAndConditions: { type: [String], default: [] },
    type: { type: String, required: true, trim: true, index: true },
    bankName: { type: String, required: true, trim: true, index: true },
    rank: { type: Number, default: 9999, index: true },
    cardNetwork: {
      type: String,
      trim: true,
      enum: Object.values(CardNetwork),
      default: CardNetwork.OTHER,
    },
    status: {
      index: true,
      type: String,
      default: BankProductStatus.ACTIVE,
      enum: Object.values(BankProductStatus),
    },
  },
  { timestamps: true },
);

bankProductSchema.index({ bankName: 1, name: 1 });
bankProductSchema.index({
  type: 1,
  status: 1,
  featured: -1,
  priorityOrder: 1,
  rank: 1,
});
bankProductSchema.index({
  type: 1,
  bankName: 1,
  cardType: 1,
  cardNetwork: 1,
});

export const BankProduct = mongoose.model<IBankProduct>(
  "BankProduct",
  bankProductSchema,
);
