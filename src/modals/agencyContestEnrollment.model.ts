import mongoose, { Document, Schema, Types } from "mongoose";

export type AgencyContestEnrollmentStatus = "active" | "completed" | "cancelled";

export interface IAgencyContestEnrollment extends Document {
  ownerAgency: Types.ObjectId;
  contest: Types.ObjectId;
  status: AgencyContestEnrollmentStatus;
  activatedAt: Date;
  deactivatedAt?: Date;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgencyContestEnrollmentSchema = new Schema<IAgencyContestEnrollment>(
  {
    ownerAgency: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      required: true,
      index: true,
    },
    contest: {
      type: Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "completed", "cancelled"],
      default: "active",
      index: true,
    },
    activatedAt: { type: Date, default: Date.now, index: true },
    deactivatedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Agency" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Agency" },
  },
  { timestamps: true },
);

AgencyContestEnrollmentSchema.index(
  { ownerAgency: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "owner_single_active_contest",
  },
);
AgencyContestEnrollmentSchema.index({ ownerAgency: 1, activatedAt: -1 });

export const AgencyContestEnrollment =
  mongoose.model<IAgencyContestEnrollment>(
    "AgencyContestEnrollment",
    AgencyContestEnrollmentSchema,
  );

