import mongoose, { Document, Schema, Types } from "mongoose";

export interface IStatementFolder extends Document {
  user: Types.ObjectId;
  name: string;
  themeColor?: string;
  themeIcon?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const StatementFolderSchema = new Schema<IStatementFolder>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    themeColor: { type: String },
    themeIcon: { type: String },
  },
  { timestamps: true }
);

StatementFolderSchema.index({ user: 1, updatedAt: -1 });

export interface IStatementFolderDocument extends Document {
  user: Types.ObjectId;
  folder: Types.ObjectId;
  title: string;
  fileUrl: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const StatementFolderDocumentSchema = new Schema<IStatementFolderDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    folder: { type: Schema.Types.ObjectId, ref: "StatementFolder", required: true },
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String },
    fileSize: { type: Number },
    fileType: { type: String },
  },
  { timestamps: true }
);

StatementFolderDocumentSchema.index({ user: 1, folder: 1, createdAt: -1 });

export const StatementFolder = mongoose.model<IStatementFolder>(
  "StatementFolder",
  StatementFolderSchema
);

export const StatementFolderDocument = mongoose.model<IStatementFolderDocument>(
  "StatementFolderDocument",
  StatementFolderDocumentSchema
);
