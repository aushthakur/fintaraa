import mongoose, { Document, Schema } from "mongoose";

export interface IDocumentCatalog extends Document {
  key: string;
  label: string;
  required?: boolean;
  numberLabel?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const DocumentCatalogSchema = new Schema<IDocumentCatalog>(
  {
    key: { type: String, required: true, trim: true, unique: true },
    label: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
    numberLabel: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

DocumentCatalogSchema.index({ isActive: 1, sortOrder: 1 });

export const DocumentCatalog = mongoose.model<IDocumentCatalog>(
  "DocumentCatalog",
  DocumentCatalogSchema
);
