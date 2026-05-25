import { Document, Schema, Types, model } from "mongoose";

export type DocumentRequestTargetRole = "user" | "agency" | "agency_member";
export type DocumentRequestStatus = "pending" | "uploaded" | "cancelled";

export interface IDocumentRequest extends Document {
  targetUser: Types.ObjectId;
  targetRole: DocumentRequestTargetRole;
  loanQuery?: Types.ObjectId;
  requestedBy?: Types.ObjectId;
  requestedDocuments: string[];
  message?: string;
  status: DocumentRequestStatus;
  fulfilledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentRequestSchema = new Schema<IDocumentRequest>(
  {
    targetUser: { type: Schema.Types.ObjectId, required: true, index: true },
    targetRole: {
      type: String,
      enum: ["user", "agency", "agency_member"],
      default: "user",
      required: true,
      index: true,
    },
    loanQuery: { type: Schema.Types.ObjectId, ref: "LoanQuery", index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    requestedDocuments: { type: [String], default: [] },
    message: { type: String, trim: true },
    status: {
      type: String,
      enum: ["pending", "uploaded", "cancelled"],
      default: "pending",
      index: true,
    },
    fulfilledAt: { type: Date },
  },
  { timestamps: true },
);

DocumentRequestSchema.index({ targetUser: 1, status: 1, createdAt: -1 });

export const DocumentRequest = model<IDocumentRequest>(
  "DocumentRequest",
  DocumentRequestSchema,
);
