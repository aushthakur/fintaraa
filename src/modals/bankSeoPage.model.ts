import mongoose, { Document, Schema } from "mongoose";

export enum BankSeoPageStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export interface IBankSeoLocation {
  city?: string;
  area?: string;
  state?: string;
  country?: string;
  pincode?: string;
}

export interface IBankSeoStat {
  label: string;
  value: string;
  text?: string;
}

export interface IBankSeoTab {
  key: string;
  label: string;
  title?: string;
  content?: string[];
  bullets?: string[];
  sortOrder?: number;
  isActive?: boolean;
}

export interface IBankSeoProduct {
  title: string;
  href?: string;
  ctaLabel?: string;
  sortOrder?: number;
  isActive?: boolean;
  description?: string;
}

export interface IBankSeoRate {
  tenure: string;
  sortOrder?: number;
  loanAmount: string;
  interestRate: string;
  processingFee: string;
}

export interface IBankSeoPage extends Document {
  title: string;
  bankName: string;
  bankSlug: string;
  logoUrl?: string;
  subtitle?: string;
  seoTitle?: string;
  productName: string;
  productSlug: string;
  trustBadge?: string;
  aboutTitle?: string;
  heroImageUrl?: string;
  canonicalPath?: string;
  seoDescription?: string;
  aboutDescription?: string;
  location: IBankSeoLocation;
  heroStats: IBankSeoStat[];
  bankStats: IBankSeoStat[];
  whyApply: string[];
  tabs: IBankSeoTab[];
  applyBullets: string[];
  products: IBankSeoProduct[];
  interestRates: IBankSeoRate[];
  priority: number;
  publishedAt?: Date;
  isFeatured: boolean;
  isIndexable: boolean;
  status: BankSeoPageStatus;
  createdAt: Date;
  updatedAt: Date;
}

const normalizeSlug = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const normalizeKey = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const locationSchema = new Schema<IBankSeoLocation>(
  {
    city: { type: String, trim: true, default: "", index: true },
    area: { type: String, trim: true, default: "", index: true },
    state: { type: String, trim: true, default: "", index: true },
    pincode: { type: String, trim: true, default: "", index: true },
    country: { type: String, trim: true, default: "India", index: true },
  },
  { _id: false },
);

const statSchema = new Schema<IBankSeoStat>(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
    text: { type: String, trim: true },
  },
  { _id: false },
);

const tabSchema = new Schema<IBankSeoTab>(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    title: { type: String, trim: true },
    content: { type: [String], default: [] },
    bullets: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const productSchema = new Schema<IBankSeoProduct>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    ctaLabel: { type: String, trim: true, default: "Apply Now" },
    href: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const rateSchema = new Schema<IBankSeoRate>(
  {
    loanAmount: { type: String, required: true, trim: true },
    interestRate: { type: String, required: true, trim: true },
    processingFee: { type: String, required: true, trim: true },
    tenure: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const bankSeoPageSchema = new Schema<IBankSeoPage>(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true },
    bankName: { type: String, required: true, trim: true },
    bankSlug: { type: String, required: true, trim: true, index: true },
    productName: { type: String, required: true, trim: true },
    productSlug: { type: String, required: true, trim: true, index: true },
    logoUrl: { type: String, trim: true },
    heroImageUrl: { type: String, trim: true },
    trustBadge: { type: String, trim: true, default: "Trusted Partner" },
    seoTitle: { type: String, trim: true },
    seoDescription: { type: String, trim: true },
    canonicalPath: { type: String, trim: true },
    aboutTitle: { type: String, trim: true },
    aboutDescription: { type: String, trim: true },
    location: { type: locationSchema, default: () => ({ country: "India" }) },
    heroStats: { type: [statSchema], default: [] },
    bankStats: { type: [statSchema], default: [] },
    whyApply: { type: [String], default: [] },
    products: { type: [productSchema], default: [] },
    tabs: { type: [tabSchema], default: [] },
    interestRates: { type: [rateSchema], default: [] },
    applyBullets: { type: [String], default: [] },
    status: {
      type: String,
      enum: Object.values(BankSeoPageStatus),
      default: BankSeoPageStatus.DRAFT,
      index: true,
    },
    publishedAt: { type: Date },
    isIndexable: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    priority: { type: Number, default: 100, index: true },
  },
  { timestamps: true },
);

bankSeoPageSchema.pre("validate", function normalizeBankSeoPage(next) {
  this.bankSlug = normalizeSlug(this.bankSlug || this.bankName);
  this.productSlug = normalizeSlug(this.productSlug || this.productName);
  this.tabs = (this.tabs || []).map((tab: any) => ({
    ...tab,
    key: normalizeKey(tab.key || tab.label),
  }));
  next();
});

bankSeoPageSchema.index(
  {
    bankSlug: 1,
    productSlug: 1,
    "location.country": 1,
    "location.state": 1,
    "location.city": 1,
    "location.pincode": 1,
    "location.area": 1,
  },
  { unique: true },
);

export const BankSeoPage = mongoose.model<IBankSeoPage>(
  "BankSeoPage",
  bankSeoPageSchema,
);
