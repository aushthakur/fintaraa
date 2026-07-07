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

FormSubmitClickSchema.index({ createdAt: -1 });
FormSubmitClickSchema.index({ action: 1, createdAt: -1 });
FormSubmitClickSchema.index({ formType: 1, createdAt: -1 });
FormSubmitClickSchema.index({ "meta.actorKind": 1, createdAt: -1 });
FormSubmitClickSchema.index({ "meta.actorRole": 1, createdAt: -1 });
FormSubmitClickSchema.index({ "meta.agencyId": 1, createdAt: -1 });
FormSubmitClickSchema.index({ "meta.leadId": 1, createdAt: -1 });
FormSubmitClickSchema.index({ "meta.source": 1, createdAt: -1 });
FormSubmitClickSchema.index({ "meta.platform": 1, createdAt: -1 });

export const FormSubmitClick = model<IFormSubmitClick>(
  "FormSubmitClick",
  FormSubmitClickSchema
);
