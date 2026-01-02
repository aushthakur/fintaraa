import { Schema, model, Document, Types } from "mongoose";

export interface IFormSubmitClick extends Document {
  user: Types.ObjectId;
  formType: string;
  action: "submitted" | "draft" | "continue";
  stepIndex?: number;
  totalSteps?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const FormSubmitClickSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    formType: { type: String, trim: true, required: true },
    action: {
      type: String,
      enum: ["submitted", "draft", "continue"],
      default: "submitted",
    },
    stepIndex: { type: Number },
    totalSteps: { type: Number },
  },
  { timestamps: true }
);

export const FormSubmitClick = model<IFormSubmitClick>(
  "FormSubmitClick",
  FormSubmitClickSchema
);
