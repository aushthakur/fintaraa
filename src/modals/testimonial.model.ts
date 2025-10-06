import mongoose, { Document, Schema, Types, model } from "mongoose";

export interface ITestimonial extends Document {
  name: string;
  email: string;
  rating: number;
  message: string;
  createdAt?: Date;
  updatedAt?: Date;
  isActive: Boolean;
  imageUrl?: string;
}

const TestimonialSchema = new Schema<ITestimonial>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

export const Testimonial = model<ITestimonial>(
  "Testimonial",
  TestimonialSchema
);
