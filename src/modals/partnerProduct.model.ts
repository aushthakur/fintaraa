import mongoose, { Document, Schema, Types } from "mongoose";
import { PartnerProductCategory } from "./partner.model";

export enum PartnerFeeType {
  PERCENTAGE = "percentage",
  FLAT = "flat",
  NONE = "none",
}

export enum PartnerIncomePeriod {
  MONTHLY = "monthly",
  ANNUAL = "annual",
}

export enum PartnerProductOrigin {
  MANUAL = "manual",
  LEGACY_BANKER = "legacy_banker",
  LEGACY_BANK_PRODUCT = "legacy_bank_product",
  LEGACY_ELIGIBILITY = "legacy_eligibility",
  LEGACY_SEO = "legacy_seo",
  LEGACY_MIXED = "legacy_mixed",
}

export interface IPartnerProduct extends Document {
  partner: Types.ObjectId;
  category: PartnerProductCategory;
  productType: string;
  code: string;
  name: string;
  description?: string;
  interestRateMin?: number;
  interestRateMax?: number;
  processingFee: { type: PartnerFeeType; value?: number };
  amountMin?: number;
  amountMax?: number;
  tenureMinMonths?: number;
  tenureMaxMonths?: number;
  eligibility: {
    cibilMin?: number;
    cibilMax?: number;
    incomeMin?: number;
    incomeMax?: number;
    incomePeriod: PartnerIncomePeriod;
    employmentTypes: string[];
    ageMin?: number;
    ageMax?: number;
    cities: string[];
    pincodes: string[];
    companyCategories: string[];
  };
  insurance: {
    premiumMin?: number;
    premiumMax?: number;
    coverageMin?: number;
    coverageMax?: number;
    policyTermMinMonths?: number;
    policyTermMaxMonths?: number;
  };
  active: boolean;
  published: boolean;
  assignmentEnabled: boolean;
  priority: number;
  origin: PartnerProductOrigin;
  migrationVersion: number;
  assignmentPolicyVersion: number;
  sourceReferences: {
    bankerIds: Types.ObjectId[];
    bankProductIds: Types.ObjectId[];
    eligibilityCriteriaIds: Types.ObjectId[];
    bankSeoPageIds: Types.ObjectId[];
  };
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export const normalizePartnerProductCode = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizedStringList = (values: unknown[]) =>
  Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

const partnerProductSchema = new Schema<IPartnerProduct>(
  {
    partner: {
      type: Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(PartnerProductCategory),
      required: true,
      index: true,
    },
    productType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: "", maxlength: 5000 },
    interestRateMin: { type: Number, min: 0, max: 100 },
    interestRateMax: { type: Number, min: 0, max: 100 },
    processingFee: {
      type: {
        type: String,
        enum: Object.values(PartnerFeeType),
        default: PartnerFeeType.NONE,
      },
      value: { type: Number, min: 0 },
    },
    amountMin: { type: Number, min: 0 },
    amountMax: { type: Number, min: 0 },
    tenureMinMonths: { type: Number, min: 0 },
    tenureMaxMonths: { type: Number, min: 0 },
    eligibility: {
      cibilMin: { type: Number, min: 300, max: 900 },
      cibilMax: { type: Number, min: 300, max: 900 },
      incomeMin: { type: Number, min: 0 },
      incomeMax: { type: Number, min: 0 },
      incomePeriod: {
        type: String,
        enum: Object.values(PartnerIncomePeriod),
        default: PartnerIncomePeriod.MONTHLY,
      },
      employmentTypes: { type: [String], default: [] },
      ageMin: { type: Number, min: 0, max: 120 },
      ageMax: { type: Number, min: 0, max: 120 },
      cities: { type: [String], default: [] },
      pincodes: { type: [String], default: [] },
      companyCategories: { type: [String], default: [] },
    },
    insurance: {
      premiumMin: { type: Number, min: 0 },
      premiumMax: { type: Number, min: 0 },
      coverageMin: { type: Number, min: 0 },
      coverageMax: { type: Number, min: 0 },
      policyTermMinMonths: { type: Number, min: 0 },
      policyTermMaxMonths: { type: Number, min: 0 },
    },
    active: { type: Boolean, default: true, index: true },
    published: { type: Boolean, default: true, index: true },
    assignmentEnabled: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
    priority: { type: Number, default: 100, min: 0, index: true },
    origin: {
      type: String,
      enum: Object.values(PartnerProductOrigin),
      default: PartnerProductOrigin.MANUAL,
      index: true,
    },
    migrationVersion: { type: Number, default: 0, min: 0 },
    assignmentPolicyVersion: { type: Number, default: 1, min: 0 },
    sourceReferences: {
      bankerIds: [{ type: Schema.Types.ObjectId, ref: "Banker" }],
      bankProductIds: [{ type: Schema.Types.ObjectId, ref: "BankProduct" }],
      eligibilityCriteriaIds: [
        { type: Schema.Types.ObjectId, ref: "EligibilityCriteria" },
      ],
      bankSeoPageIds: [{ type: Schema.Types.ObjectId, ref: "BankSeoPage" }],
    },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

partnerProductSchema.pre("validate", function normalizeProduct(next) {
  this.productType = normalizePartnerProductCode(this.productType || this.name);
  this.code = normalizePartnerProductCode(this.code || this.name);
  const eligibility = this.eligibility;
  eligibility.employmentTypes = normalizedStringList(
    eligibility?.employmentTypes || [],
  ).map(normalizePartnerProductCode);
  eligibility.cities = normalizedStringList(eligibility?.cities || []);
  eligibility.pincodes = normalizedStringList(
    eligibility?.pincodes || [],
  ).map((value) => value.replace(/\s+/g, ""));
  eligibility.companyCategories = normalizedStringList(
    eligibility?.companyCategories || [],
  );
  next();
});

partnerProductSchema.index({ partner: 1, code: 1 }, { unique: true });
partnerProductSchema.index({
  isDeleted: 1,
  active: 1,
  published: 1,
  assignmentEnabled: 1,
  category: 1,
  productType: 1,
  priority: 1,
});
partnerProductSchema.index({ name: "text", description: "text" });

export const PartnerProduct = mongoose.model<IPartnerProduct>(
  "PartnerProduct",
  partnerProductSchema,
);
