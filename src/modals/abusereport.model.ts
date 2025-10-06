import mongoose, { Document, Schema } from "mongoose";

export interface IAbuseReport extends Document {
  reason: string;
  createdAt?: Date;
  updatedAt?: Date;
  reviewedAt?: Date;
  ipAddress?: string;
  description?: string;
  resolutionNotes?: string;
  coordinates: [number, number];
  reportedBy: mongoose.Types.ObjectId;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "under_review" | "resolved" | "dismissed";
}

const AbuseReportSchema = new Schema<IAbuseReport>(
  {
    reportedBy: {
      ref: "User",
      required: true,
      type: Schema.Types.ObjectId,
    },
    reason: { type: String, required: true },
    description: String,
    severity: {
      type: String,
      default: "medium",
      enum: ["low", "medium", "high", "critical"],
    },
    status: {
      type: String,
      required: true,
      default: "pending",
      enum: ["pending", "under_review", "resolved", "dismissed"],
    },
    reviewedAt: { type: Date },
    ipAddress: { type: String },
    resolutionNotes: { type: String },
    coordinates: {
      type: [Number],
      index: "2dsphere",
    },
  },
  { timestamps: true }
);

AbuseReportSchema.pre("save", function (next) {
  const doc = this as IAbuseReport;
  if (
    doc.isModified("resolutionNotes") &&
    doc.resolutionNotes &&
    !doc.reviewedAt
  ) {
    doc.reviewedAt = new Date();
  }
  if (doc.isModified("reason") || doc.isModified("description")) {
    const combined = `${doc.reason} ${doc.description || ""}`.toLowerCase();
    if (/threat|violence|illegal|abuse|harassment/.test(combined)) {
      doc.severity = "critical";
    } else if (/spam|scam|fraud|impersonation/.test(combined)) {
      doc.severity = "high";
    } else if (/offensive|fake|duplicate|irrelevant/.test(combined)) {
      doc.severity = "medium";
    } else {
      doc.severity = "low";
    }
  }
  next();
});

AbuseReportSchema.index({ reportedBy: 1, createdAt: -1 });
AbuseReportSchema.index({ severity: 1, status: 1, createdAt: -1 });
AbuseReportSchema.index({ reviewedAt: -1 });
AbuseReportSchema.index({ ipAddress: 1 });

export const AbuseReport = mongoose.model<IAbuseReport>(
  "AbuseReport",
  AbuseReportSchema
);
