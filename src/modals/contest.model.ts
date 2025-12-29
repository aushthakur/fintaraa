import mongoose, { Document, Schema } from "mongoose";

export type ContestStatus = "active" | "inactive";

export interface IContest extends Document {
  title: string;
  targetLabel: string;
  periodLabel: string;
  description?: string;
  image?: string;
  ctaText?: string;
  status: ContestStatus;
  priority: number;
  validFrom?: Date;
  validTo?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const ContestSchema = new Schema<IContest>(
  {
    title: { type: String, required: true, trim: true },
    targetLabel: { type: String, required: true, trim: true },
    periodLabel: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    image: { type: String, default: "" },
    ctaText: { type: String, trim: true, default: "Accept New Target" },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    priority: { type: Number, default: 1 },
    validFrom: { type: Date },
    validTo: { type: Date },
  },
  { timestamps: true }
);

export const Contest = mongoose.model<IContest>("Contest", ContestSchema);
