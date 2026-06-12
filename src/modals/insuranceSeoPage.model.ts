import mongoose, { Document, Schema } from "mongoose";

export enum InsuranceSeoPageStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export interface IInsuranceSeoPage extends Document {
  title: string;
  subtitle?: string;
  seoTitle?: string;
  heroTitle?: string;
  insuranceType: string;
  canonicalPath?: string;
  seoDescription?: string;
  heroDescription?: string;
  insuranceTypeSlug: string;
  location: {
    city?: string;
    area?: string;
    state?: string;
    country?: string;
    pincode?: string;
  };
  tabs: Array<{
    key: string;
    label: string;
    title: string;
    bullets?: string[];
    covered?: string[];
    isActive?: boolean;
    sortOrder?: number;
    description?: string;
    notCovered?: string[];
    filterKeys?: string[];
    faqs?: Array<{ question: string; answer: string }>;
  }>;
  formFields: Array<{
    key: string;
    type: string;
    label: string;
    required?: boolean;
    options?: string[];
    filterKey?: string;
    sortOrder?: number;
    isActive?: boolean;
    placeholder?: string;
  }>;
  badges: string[];
  priority: number;
  publishedAt?: Date;
  isFeatured: boolean;
  filterKeys: string[];
  isIndexable: boolean;
  status: InsuranceSeoPageStatus;
}

const normalizeKey = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const locationSchema = new Schema(
  {
    country: { type: String, trim: true, default: "India", index: true },
    state: { type: String, trim: true, default: "", index: true },
    city: { type: String, trim: true, default: "", index: true },
    pincode: { type: String, trim: true, default: "", index: true },
    area: { type: String, trim: true, default: "", index: true },
  },
  { _id: false },
);

const insuranceSeoPageSchema = new Schema<IInsuranceSeoPage>(
  {
    insuranceType: { type: String, required: true, trim: true },
    insuranceTypeSlug: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true },
    heroTitle: { type: String, trim: true },
    heroDescription: { type: String, trim: true },
    seoTitle: { type: String, trim: true },
    seoDescription: { type: String, trim: true },
    canonicalPath: { type: String, trim: true },
    location: { type: locationSchema, default: () => ({ country: "India" }) },
    tabs: {
      type: [
        {
          key: { type: String, required: true, trim: true, lowercase: true },
          label: { type: String, required: true, trim: true },
          title: { type: String, required: true, trim: true },
          description: { type: String, trim: true },
          covered: { type: [String], default: [] },
          notCovered: { type: [String], default: [] },
          bullets: { type: [String], default: [] },
          faqs: {
            type: [
              {
                question: { type: String, trim: true },
                answer: { type: String, trim: true },
              },
            ],
            default: [],
          },
          filterKeys: { type: [String], default: [] },
          sortOrder: { type: Number, default: 0 },
          isActive: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    formFields: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          type: { type: String, required: true, trim: true, default: "text" },
          placeholder: { type: String, trim: true },
          required: { type: Boolean, default: false },
          options: { type: [String], default: [] },
          filterKey: { type: String, trim: true, lowercase: true },
          sortOrder: { type: Number, default: 0 },
          isActive: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    filterKeys: { type: [String], default: [] },
    badges: { type: [String], default: [] },
    status: {
      type: String,
      enum: Object.values(InsuranceSeoPageStatus),
      default: InsuranceSeoPageStatus.DRAFT,
      index: true,
    },
    isIndexable: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    priority: { type: Number, default: 100, index: true },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

insuranceSeoPageSchema.pre(
  "validate",
  function normalizeInsuranceSeoPage(next) {
    this.insuranceTypeSlug = normalizeKey(
      this.insuranceTypeSlug || this.insuranceType,
    ).replace(/_/g, "-");
    this.filterKeys = (this.filterKeys || []).map(normalizeKey).filter(Boolean);
    this.tabs = (this.tabs || []).map((tab: any) => ({
      ...tab,
      key: normalizeKey(tab.key || tab.label),
      filterKeys: (tab.filterKeys || []).map(normalizeKey).filter(Boolean),
    }));
    this.formFields = (this.formFields || []).map((field: any) => ({
      ...field,
      filterKey: normalizeKey(field.filterKey || field.key),
    }));
    next();
  },
);

insuranceSeoPageSchema.index(
  {
    "location.city": 1,
    "location.area": 1,
    "location.state": 1,
    insuranceTypeSlug: 1,
    "location.country": 1,
    "location.pincode": 1,
  },
  { unique: true },
);

export const InsuranceSeoPage = mongoose.model<IInsuranceSeoPage>(
  "InsuranceSeoPage",
  insuranceSeoPageSchema,
);
