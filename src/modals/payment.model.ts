import { Schema, model, Document, Types } from "mongoose";

export interface IPayment extends Document {
  amount: number;
  paymentDate: Date;
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  transactionId?: string;
  meta?: Record<string, any>;
  status: "pending" | "completed" | "failed";
  method: "stripe" | "razorpay" | "paypal" | "dpo";
}

const paymentSchema = new Schema<IPayment>(
  {
    paymentDate: { type: Date },
    transactionId: { type: String },
    meta: { type: Schema.Types.Mixed },
    amount: { type: Number, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "completed", "failed"],
    },
    method: {
      type: String,
      required: true,
      enum: ["stripe", "razorpay", "paypal", "dpo"],
    },
  },
  { timestamps: true }
);

export const Payment = model<IPayment>("Payment", paymentSchema);
