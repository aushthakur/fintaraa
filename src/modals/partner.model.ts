import mongoose, { Document, Schema, Types } from "mongoose";

export enum PartnerType {
  BANK = "bank",
  NBFC = "nbfc",
  INSURER = "insurer",
}

export enum PartnerStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum PartnerIntegrationStatus {
  NOT_CONFIGURED = "not_configured",
  CONFIGURED = "configured",
  CONNECTED = "connected",
  ERROR = "error",
}

export enum PartnerProductCategory {
  LOAN = "loan",
  INSURANCE = "insurance",
  CREDIT_CARD = "credit_card",
}

export interface IPartnerContact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface IPartner extends Document {
  name: string;
  slug: string;
  logo?: string;
  type: PartnerType;
  status: PartnerStatus;
  featured: boolean;
  priority: number;
  website?: string;
  description?: string;
  regulatoryIds: {
    rbiRegistrationNumber?: string;
    irdaRegistrationNumber?: string;
    cin?: string;
    gstin?: string;
    licenseNumber?: string;
  };
  contacts: IPartnerContact[];
  productCategories: PartnerProductCategory[];
  serviceAreas: {
    countrywide: boolean;
    states: string[];
    cities: string[];
    pincodes: string[];
  };
  integrationStatus: PartnerIntegrationStatus;
  integrationLastCheckedAt?: Date;
  integrationMessage?: string;
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

export const normalizePartnerSlug = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeStringList = (values: unknown[]) =>
  Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

const partnerContactSchema = new Schema<IPartnerContact>(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const partnerSchema = new Schema<IPartner>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    logo: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: Object.values(PartnerType),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(PartnerStatus),
      default: PartnerStatus.ACTIVE,
      index: true,
    },
    featured: { type: Boolean, default: false, index: true },
    priority: { type: Number, default: 100, min: 0, index: true },
    website: { type: String, trim: true, default: "", maxlength: 500 },
    description: { type: String, trim: true, default: "", maxlength: 5000 },
    regulatoryIds: {
      rbiRegistrationNumber: { type: String, trim: true, default: "" },
      irdaRegistrationNumber: { type: String, trim: true, default: "" },
      cin: { type: String, trim: true, uppercase: true, default: "" },
      gstin: { type: String, trim: true, uppercase: true, default: "" },
      licenseNumber: { type: String, trim: true, default: "" },
    },
    contacts: { type: [partnerContactSchema], default: [] },
    productCategories: {
      type: [{ type: String, enum: Object.values(PartnerProductCategory) }],
      default: [],
      index: true,
    },
    serviceAreas: {
      countrywide: { type: Boolean, default: true },
      states: { type: [String], default: [] },
      cities: { type: [String], default: [] },
      pincodes: { type: [String], default: [] },
    },
    integrationStatus: {
      type: String,
      enum: Object.values(PartnerIntegrationStatus),
      default: PartnerIntegrationStatus.NOT_CONFIGURED,
      index: true,
    },
    integrationLastCheckedAt: { type: Date },
    integrationMessage: { type: String, trim: true, default: "" },
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

partnerSchema.pre("validate", function normalizePartner(next) {
  this.slug = normalizePartnerSlug(this.slug || this.name);
  this.productCategories = Array.from(new Set(this.productCategories || []));
  this.serviceAreas.states = normalizeStringList(this.serviceAreas?.states || []);
  this.serviceAreas.cities = normalizeStringList(this.serviceAreas?.cities || []);
  this.serviceAreas.pincodes = normalizeStringList(
    this.serviceAreas?.pincodes || [],
  ).map((value) => value.replace(/\s+/g, ""));
  next();
});

partnerSchema.index({ slug: 1 }, { unique: true });
partnerSchema.index({ isDeleted: 1, status: 1, priority: 1, name: 1 });
partnerSchema.index({
  isDeleted: 1,
  status: 1,
  type: 1,
  productCategories: 1,
});
partnerSchema.index({ name: "text", description: "text" });

export const Partner = mongoose.model<IPartner>("Partner", partnerSchema);
