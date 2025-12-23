import mongoose, { Schema, Document } from "mongoose";

export interface ICounter extends Document {
  key: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 1000 },
  },
  { timestamps: true }
);

CounterSchema.index({ key: 1 }, { unique: true });

export const Counter = mongoose.model<ICounter>("Counter", CounterSchema);
