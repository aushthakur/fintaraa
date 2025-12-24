import mongoose, { Document, Schema, Types } from "mongoose";

export type StatementDocType =
  | "bank_letter"
  | "sanction_document"
  | "repayment_schedule"
  | "welcome_kit"
  | "account_statement"
  | "foreclosure_letter"
  | "noc_letter"
  | "disbursement_letter";

export interface IStatementDocument extends Document {
  user: Types.ObjectId;
  docType: StatementDocType;
  title: string;
  fileUrl: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  issuedOn?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const StatementDocumentSchema = new Schema<IStatementDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    docType: { type: String, required: true },
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String },
    fileSize: { type: Number },
    fileType: { type: String },
    issuedOn: { type: Date },
  },
  { timestamps: true }
);

StatementDocumentSchema.index({ user: 1, createdAt: -1 });

export const StatementDocument = mongoose.model<IStatementDocument>(
  "StatementDocument",
  StatementDocumentSchema
);
