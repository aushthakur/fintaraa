import mongoose, { Document, Schema } from "mongoose";

export enum CompanyCategoryStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export type CompanyCategoryLabel = "CAT A" | "CAT B" | "CAT C";

export interface ICompanyBankCategory extends Document {
  masterType: "company_bank_category";
  slug: string;
  companyName: string;
  companyKey: string;
  bankName: string;
  bankKey: string;
  categories: CompanyCategoryLabel[];
  aliases?: string[];
  remarks?: string;
  status: CompanyCategoryStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const CompanyBankCategorySchema = new Schema<ICompanyBankCategory>(
  {
    masterType: {
      type: String,
      required: true,
      default: "company_bank_category",
      index: true,
    },
    slug: { type: String, required: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    companyKey: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    bankKey: { type: String, required: true, trim: true },
    categories: {
      type: [{ type: String, enum: ["CAT A", "CAT B", "CAT C"] }],
      default: [],
    },
    aliases: { type: [String], default: [] },
    remarks: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(CompanyCategoryStatus),
      default: CompanyCategoryStatus.ACTIVE,
      index: true,
    },
  },
  { timestamps: true },
);

CompanyBankCategorySchema.index(
  { masterType: 1, companyKey: 1, bankKey: 1 },
  {
    unique: true,
    partialFilterExpression: { masterType: "company_bank_category" },
  },
);
CompanyBankCategorySchema.index({
  masterType: 1,
  status: 1,
  companyKey: 1,
  bankKey: 1,
});

export const CompanyBankCategory =
  mongoose.model<ICompanyBankCategory>(
    "CompanyBankCategory",
    CompanyBankCategorySchema,
    "knowledges",
  );
