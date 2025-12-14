import { Document, Schema, Types, model } from "mongoose";
import { EmploymentType, LoanProductType } from "./user.model";

export interface IOfferEligibility {
  minAge?: number;
  maxAge?: number;
  tags?: string[];
  minIncome?: number;
  maxIncome?: number;
  minCreditScore?: number;
  allowedStates?: string[];
  allowedCities?: string[];
  maxEmiPerIncome?: number;
  maxActiveObligations?: number;
  employmentTypes?: EmploymentType[];
  allowedProductTypes?: LoanProductType[];
}

export interface IOfferApplication {
  notes?: string;
  appliedAt: Date;
  user: Types.ObjectId;
  metadata?: Record<string, any>;
  status: "applied" | "interested";
}

export interface IOffer extends Document {
  title: string;
  lenderName: string;
  productType?: LoanProductType | "insurance" | "card" | "other";
  rateLabel?: string;
  tenureLabel?: string;
  amountLabel?: string;
  badge?: string;
  description?: string;
  ctaText?: string;
  status: "draft" | "active" | "expired";
  tags: string[];
  validFrom?: Date;
  validTo?: Date;
  eligibility?: IOfferEligibility;
  applications?: IOfferApplication[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OfferEligibilitySchema = new Schema<IOfferEligibility>(
  {
    minIncome: Number,
    maxIncome: Number,
    maxEmiPerIncome: Number,
    minCreditScore: Number,
    maxActiveObligations: Number,
    employmentTypes: [
      {
        type: String,
        enum: Object.values(EmploymentType),
      },
    ],
    allowedProductTypes: [
      {
        type: String,
        enum: Object.values(LoanProductType),
      },
    ],
    allowedStates: [String],
    allowedCities: [String],
    minAge: Number,
    maxAge: Number,
    tags: [String],
  },
  { _id: false }
);

const OfferApplicationSchema = new Schema<IOfferApplication>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["applied", "interested"],
      default: "applied",
    },
    appliedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
    metadata: { type: Object },
  },
  { _id: false }
);

const OfferSchema = new Schema<IOffer>(
  {
    title: { type: String, required: true, trim: true },
    lenderName: { type: String, required: true, trim: true },
    productType: {
      type: String,
      enum: [...Object.values(LoanProductType), "insurance", "card", "other"],
      default: LoanProductType.PERSONAL_LOAN,
    },
    rateLabel: { type: String, trim: true },
    tenureLabel: { type: String, trim: true },
    amountLabel: { type: String, trim: true },
    badge: { type: String, trim: true },
    description: { type: String, trim: true },
    ctaText: { type: String, trim: true, default: "Apply now" },
    status: {
      type: String,
      enum: ["draft", "active", "expired"],
      default: "draft",
      index: true,
    },
    tags: { type: [String], default: [] },
    validFrom: { type: Date },
    validTo: { type: Date },
    eligibility: { type: OfferEligibilitySchema, default: {} },
    applications: { type: [OfferApplicationSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

OfferSchema.index({ status: 1, validFrom: 1, validTo: 1 });

export const Offer = model<IOffer>("Offer", OfferSchema);
