import mongoose, { Document, Schema } from "mongoose";

export type BankerStatus = "active" | "inactive";

export interface IBanker extends Document {
  name: string;
  logo?: string;
  rateLabel?: string;
  tatLabel?: string;
  coverageLabel?: string;
  managerName?: string;
  managerRole?: string;
  managerEmail?: string;
  managerPhone?: string;
  products: string[];
  categories: string[];
  highlights: string[];
  about?: string;
  location?: string;
  status: BankerStatus;
  priority: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const BankerSchema = new Schema<IBanker>(
  {
    name: { type: String, required: true, trim: true },
    logo: { type: String, default: "" },
    rateLabel: { type: String, trim: true, default: "" },
    tatLabel: { type: String, trim: true, default: "" },
    coverageLabel: { type: String, trim: true, default: "" },
    managerName: { type: String, trim: true, default: "" },
    managerRole: { type: String, trim: true, default: "" },
    managerEmail: { type: String, trim: true, lowercase: true, default: "" },
    managerPhone: { type: String, trim: true, default: "" },
    products: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    about: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    priority: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export const Banker = mongoose.model<IBanker>("Banker", BankerSchema);
