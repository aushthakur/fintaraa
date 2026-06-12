import mongoose, { Document, Schema } from "mongoose";

export enum LoanSeoPageStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export interface ILoanSeoLocation {
  city?: string;
  area?: string;
  state?: string;
  country?: string;
  pincode?: string;
}

export interface ILoanSeoTab {
  key: string;
  title: string;
  label: string;
  eyebrow?: string;
  bullets?: string[];
  content?: string[];
  sortOrder?: number;
  isActive?: boolean;
  description?: string;
  filterKeys?: string[];
  stats?: Array<{ label: string; value: string }>;
  faqs?: Array<{ question: string; answer: string }>;
}

export interface ILoanSeoFormField {
  key: string;
  type: string;
  label: string;
  tabKey?: string;
  required?: boolean;
  options?: string[];
  filterKey?: string;
  sortOrder?: number;
  isActive?: boolean;
  placeholder?: string;
}

export interface ILoanSeoPage extends Document {
  title: string;
  loanType: string;
  seoTitle?: string;
  subtitle?: string;
  heroTitle?: string;
  tabs: ILoanSeoTab[];
  loanTypeSlug: string;
  canonicalPath?: string;
  seoDescription?: string;
  heroDescription?: string;
  location: ILoanSeoLocation;
  formFields: ILoanSeoFormField[];
  badges: string[];
  priority: number;
  publishedAt?: Date;
  isFeatured: boolean;
  filterKeys: string[];
  isIndexable: boolean;
  status: LoanSeoPageStatus;
  createdAt: Date;
  updatedAt: Date;
}

const normalizeKey = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const locationSchema = new Schema<ILoanSeoLocation>(
  {
    city: { type: String, trim: true, default: "", index: true },
    area: { type: String, trim: true, default: "", index: true },
    state: { type: String, trim: true, default: "", index: true },
    pincode: { type: String, trim: true, default: "", index: true },
    country: { type: String, trim: true, default: "India", index: true },
  },
  { _id: false },
);

const tabSchema = new Schema<ILoanSeoTab>(
  {
    eyebrow: { type: String, trim: true },
    bullets: { type: [String], default: [] },
    content: { type: [String], default: [] },
    description: { type: String, trim: true },
    label: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    stats: {
      type: [
        {
          label: { type: String, trim: true },
          value: { type: String, trim: true },
        },
      ],
      default: [],
    },
    faqs: {
      type: [
        {
          question: { type: String, trim: true },
          answer: { type: String, trim: true },
        },
      ],
      default: [],
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    filterKeys: { type: [String], default: [] },
  },
  { _id: false },
);

const formFieldSchema = new Schema<ILoanSeoFormField>(
  {
    sortOrder: { type: Number, default: 0 },
    options: { type: [String], default: [] },
    placeholder: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    required: { type: Boolean, default: false },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    tabKey: { type: String, trim: true, lowercase: true },
    filterKey: { type: String, trim: true, lowercase: true },
    type: { type: String, required: true, trim: true, default: "text" },
  },
  { _id: false },
);

const loanSeoPageSchema = new Schema<ILoanSeoPage>(
  {
    subtitle: { type: String, trim: true },
    seoTitle: { type: String, trim: true },
    heroTitle: { type: String, trim: true },
    badges: { type: [String], default: [] },
    tabs: { type: [tabSchema], default: [] },
    filterKeys: { type: [String], default: [] },
    canonicalPath: { type: String, trim: true },
    seoDescription: { type: String, trim: true },
    heroDescription: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    formFields: { type: [formFieldSchema], default: [] },
    loanType: { type: String, required: true, trim: true },
    loanTypeSlug: { type: String, required: true, trim: true, index: true },
    location: { type: locationSchema, default: () => ({ country: "India" }) },
    status: {
      index: true,
      type: String,
      default: LoanSeoPageStatus.DRAFT,
      enum: Object.values(LoanSeoPageStatus),
    },
    publishedAt: { type: Date },
    isIndexable: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    priority: { type: Number, default: 100, index: true },
  },
  { timestamps: true },
);

loanSeoPageSchema.pre("validate", function normalizeLoanSeoPage(next) {
  this.loanTypeSlug = normalizeKey(this.loanTypeSlug || this.loanType).replace(
    /_/g,
    "-",
  );
  this.filterKeys = (this.filterKeys || []).map(normalizeKey).filter(Boolean);
  this.tabs = (this.tabs || []).map((tab: any) => ({
    ...tab,
    key: normalizeKey(tab.key || tab.label),
    filterKeys: (tab.filterKeys || []).map(normalizeKey).filter(Boolean),
  }));
  this.formFields = (this.formFields || []).map((field: any) => ({
    ...field,
    filterKey: normalizeKey(field.filterKey || field.key),
    tabKey: normalizeKey(field.tabKey),
  }));
  next();
});

loanSeoPageSchema.index(
  {
    loanTypeSlug: 1,
    "location.city": 1,
    "location.area": 1,
    "location.state": 1,
    "location.country": 1,
    "location.pincode": 1,
  },
  { unique: true },
);

export const LoanSeoPage = mongoose.model<ILoanSeoPage>(
  "LoanSeoPage",
  loanSeoPageSchema,
);
