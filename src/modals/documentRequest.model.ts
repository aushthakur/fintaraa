import { Document, Schema, Types, model } from "mongoose";

export type DocumentRequestTargetRole = "user" | "agency" | "agency_member";
export type DocumentRequestStatus = "pending" | "uploaded" | "cancelled";

export interface IDocumentRequest extends Document {
  targetUser: Types.ObjectId;
  targetRole: DocumentRequestTargetRole;
  loanQuery?: Types.ObjectId;
  sourceReview?: Types.ObjectId;
  requestedBy?: Types.ObjectId;
  requestedDocuments: string[];
  uploadedDocuments: Array<{
    documentKey: string;
    fileUrl: string;
    uploadedAt: Date;
  }>;
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
    sourceReview: {
      type: Schema.Types.ObjectId,
      ref: "ApplicationDocumentReview",
      index: true,
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    requestedDocuments: { type: [String], default: [] },
    uploadedDocuments: {
      type: [
        new Schema(
          {
            documentKey: { type: String, required: true, trim: true },
            fileUrl: { type: String, required: true, trim: true },
            uploadedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
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
