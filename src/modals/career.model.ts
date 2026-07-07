import mongoose, { Document, Schema, Types } from "mongoose";

export type JobPostingStatus = "draft" | "published" | "archived";
export type JobApplicationStatus =
  | "received"
  | "reviewing"
  | "shortlisted"
  | "rejected"
  | "hired";

export interface IJobPosting extends Document {
  recordType: "career_job";
  slug?: string;
  title: string;
  department: string;
  location: string;
  experience: string;
  employmentType: string;
  skills: string[];
  responsibilities: string[];
  requirements: string[];
  salaryRange?: string;
  status: JobPostingStatus;
  openingsCount: number;
  applicationDeadline?: Date;
  summary?: string;
  priorityOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IJobApplication extends Document {
  recordType: "career_application";
  job?: Types.ObjectId;
  jobTitle: string;
  name: string;
  email: string;
  phone: string;
  location?: string;
  experience?: string;
  resume?: {
    url?: string;
    name?: string;
    originalname?: string;
    mimetype?: string;
    size?: number;
  };
  coverLetter?: string;
  status: JobApplicationStatus;
  remarks?: string;
  source?: string;
  platform?: string;
  formSource?: string;
  whatsappConsent?: boolean;
  communicationConsent?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const stringArray = {
  type: [String],
  default: [],
};

const JobPostingSchema = new Schema<IJobPosting>(
  {
    recordType: {
      type: String,
      default: "career_job",
      index: true,
      immutable: true,
    },
    slug: { type: String, trim: true, index: true },
    title: { type: String, trim: true, required: true, maxlength: 120 },
    department: { type: String, trim: true, required: true, maxlength: 80 },
    location: { type: String, trim: true, required: true, maxlength: 120 },
    experience: { type: String, trim: true, required: true, maxlength: 80 },
    employmentType: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80,
      default: "Full Time",
    },
    skills: stringArray,
    responsibilities: stringArray,
    requirements: stringArray,
    salaryRange: { type: String, trim: true, maxlength: 80 },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },
    openingsCount: { type: Number, min: 1, default: 1 },
    applicationDeadline: { type: Date },
    summary: { type: String, trim: true, maxlength: 1000 },
    priorityOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

JobPostingSchema.index({
  recordType: 1,
  status: 1,
  priorityOrder: 1,
  applicationDeadline: 1,
});
JobPostingSchema.index({
  recordType: 1,
  department: 1,
  location: 1,
  status: 1,
});

const ResumeSchema = new Schema(
  {
    url: { type: String, trim: true },
    name: { type: String, trim: true },
    originalname: { type: String, trim: true },
    mimetype: { type: String, trim: true },
    size: { type: Number },
  },
  { _id: false }
);

const JobApplicationSchema = new Schema<IJobApplication>(
  {
    recordType: {
      type: String,
      default: "career_application",
      index: true,
      immutable: true,
    },
    job: { type: Schema.Types.ObjectId, ref: "JobPosting", index: true },
    jobTitle: { type: String, trim: true, required: true, maxlength: 120 },
    name: { type: String, trim: true, required: true, maxlength: 100 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      maxlength: 120,
    },
    phone: { type: String, trim: true, required: true, maxlength: 15 },
    location: { type: String, trim: true, maxlength: 120 },
    experience: { type: String, trim: true, maxlength: 80 },
    resume: ResumeSchema,
    coverLetter: { type: String, trim: true, maxlength: 2000 },
    source: { type: String, trim: true, default: "website" },
    platform: { type: String, trim: true, default: "website" },
    formSource: { type: String, trim: true, default: "website_careers_join" },
    whatsappConsent: { type: Boolean, default: false },
    communicationConsent: { type: Object, default: {} },
    status: {
      type: String,
      enum: ["received", "reviewing", "shortlisted", "rejected", "hired"],
      default: "received",
      index: true,
    },
    remarks: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

JobApplicationSchema.index({ recordType: 1, status: 1, createdAt: -1 });
JobApplicationSchema.index({ recordType: 1, email: 1, createdAt: -1 });
JobApplicationSchema.index({ recordType: 1, phone: 1, createdAt: -1 });

export const JobPosting =
  mongoose.models.JobPosting ||
  mongoose.model<IJobPosting>("JobPosting", JobPostingSchema, "knowledges");

export const JobApplication =
  mongoose.models.JobApplication ||
  mongoose.model<IJobApplication>(
    "JobApplication",
    JobApplicationSchema,
    "formsubmitclicks",
  );
