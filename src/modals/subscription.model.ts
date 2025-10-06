import mongoose, { Document, Schema, model } from 'mongoose';

export interface IPlan extends Document {
  name: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  validity: number;
  priority: number;
  trialDays: number;
  isActive: boolean;
  displayName: string;
  pricePerUnit: number;
  isRecommended: boolean;
  propertyAllowed: number;
  isCustomPricing: boolean;
  bookingFeePercent: number;
  featuresIncluded: string[];
  featuresNotIncluded?: string[];
  pricePerAdditionalUnit: number;
  tag?: 'Popular' | 'Custom' | string;
  planLevel: 'flexy' | 'basic' | 'pro' | 'enterprise';
}

const PlanSchema: Schema<IPlan> = new Schema(
  {
    name: { type: String, required: true },
    priority: { type: Number, default: 14 },
    trialDays: { type: Number, default: 14 },
    validity: { type: Number, required: true },
    pricePerUnit: { type: Number, default: 0 },
    displayName: { type: String, required: true },
    bookingFeePercent: { type: Number, default: 0 },
    isCustomPricing: { type: Boolean, default: false },
    pricePerAdditionalUnit: { type: Number, default: 0 },
    featuresIncluded: { type: [String], required: true },
    featuresNotIncluded: { type: [String], default: [] },
    propertyAllowed: { type: Number, required: true, default: 1 },
    tag: { type: String, enum: ['Popular', 'Custom'], default: null },
    notes: { type: String },
    planLevel: {
      type: String,
      required: true,
      enum: ['flexy', 'basic', 'pro', 'enterprise'],
    },
    isActive: { type: Boolean, default: true },
    isRecommended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Plan =
  mongoose.models.Plan || model<IPlan>('Plan', PlanSchema);
