import { Schema, model, Document, Types } from "mongoose";

export interface IFormSubmitClick extends Document {
  user: Types.ObjectId;
  formType: string;
  action:
    | "submitted"
    | "draft"
    | "continue"
    | "start"
    | "profile_incomplete"
    | "abandoned";
  stepIndex?: number;
  totalSteps?: number;
  meta?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const FormSubmitClickSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    formType: { type: String, trim: true, required: true },
    action: {
      type: String,
      enum: [
        "submitted",
        "draft",
        "continue",
        "start",
        "profile_incomplete",
        "abandoned",
      ],
      default: "submitted",
    },
    stepIndex: { type: Number },
    totalSteps: { type: Number },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const FormSubmitClick = model<IFormSubmitClick>(
  "FormSubmitClick",
  FormSubmitClickSchema
);
