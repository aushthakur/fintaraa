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
  MASTERCARD = "Masstercard",
}

export interface IBankProduct extends Document {
  name: string;
  type: string;
  link: string;
  title: string;
  image: string;
  bankName: string;
  subtitle?: string;
  shortDescription?: string;
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
    termsAndConditions: { type: [String], default: [] },
    eligibilityTermsAndConditions: { type: [String], default: [] },
    type: { type: String, required: true, trim: true, index: true },
    bankName: { type: String, required: true, trim: true, index: true },
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
  { timestamps: true }
);

bankProductSchema.index({ bankName: 1, name: 1 });

export const BankProduct = mongoose.model<IBankProduct>(
  "BankProduct",
  bankProductSchema
);
