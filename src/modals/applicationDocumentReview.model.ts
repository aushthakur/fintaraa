import { Document, Schema, Types, model } from "mongoose";

export enum ApplicationDocumentReviewStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  REUPLOAD_REQUESTED = "reupload_requested",
}

export enum ApplicationDocumentReviewCustomerModel {
  USER = "User",
  AGENCY = "Agency",
}

export type ApplicationDocumentReviewCustomerRole =
  | "user"
  | "agency"
  | "agency_member";

export interface IApplicationDocumentReview extends Document {
  application: Types.ObjectId;
  customer: Types.ObjectId;
  customerModel: ApplicationDocumentReviewCustomerModel;
  customerRole: ApplicationDocumentReviewCustomerRole;
  documentKey: string;
  fileUrl: string;
  fileUrlHash: string;
  status: ApplicationDocumentReviewStatus;
  reviewNote?: string;
  uploadedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationDocumentReviewSchema =
  new Schema<IApplicationDocumentReview>(
    {
      application: {
        type: Schema.Types.ObjectId,
        ref: "LoanQuery",
        required: true,
        index: true,
      },
      customer: {
        type: Schema.Types.ObjectId,
        refPath: "customerModel",
        required: true,
        index: true,
      },
      customerModel: {
        type: String,
        enum: Object.values(ApplicationDocumentReviewCustomerModel),
        default: ApplicationDocumentReviewCustomerModel.USER,
        required: true,
        index: true,
      },
      customerRole: {
        type: String,
        enum: ["user", "agency", "agency_member"],
        default: "user",
        required: true,
        index: true,
      },
      documentKey: { type: String, required: true, trim: true, index: true },
      fileUrl: { type: String, required: true, trim: true },
      fileUrlHash: { type: String, required: true, trim: true },
      status: {
        type: String,
        enum: Object.values(ApplicationDocumentReviewStatus),
        default: ApplicationDocumentReviewStatus.PENDING,
        index: true,
      },
      reviewNote: { type: String, trim: true, maxlength: 1000 },
      uploadedAt: { type: Date, default: Date.now, index: true },
      reviewedAt: { type: Date },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    },
    { timestamps: true },
  );

ApplicationDocumentReviewSchema.index(
  { application: 1, documentKey: 1, fileUrlHash: 1 },
  { unique: true },
);
ApplicationDocumentReviewSchema.index({ status: 1, uploadedAt: -1 });
ApplicationDocumentReviewSchema.index({ customer: 1, customerRole: 1, uploadedAt: -1 });

export const ApplicationDocumentReview =
  model<IApplicationDocumentReview>(
    "ApplicationDocumentReview",
    ApplicationDocumentReviewSchema,
  );
