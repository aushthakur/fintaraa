import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  JobApplication,
  JobApplicationStatus,
  JobPosting,
  JobPostingStatus,
} from "../../modals/career.model";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const mobileRegex = /^(?:\+91[\s-]?)?[6-9]\d{9}$/;
const nameRegex = /^[A-Za-z][A-Za-z\s.'-]{1,99}$/;

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const normalizeMobile = (value: string) =>
  value.replace(/[\s-]/g, "").replace(/^\+91/, "");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const parseList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(cleanText).filter(Boolean);
  } catch (_err) {
    // Accept comma/newline separated values from simple admin forms.
  }
  return text
    .split(/\n|,/)
    .map(cleanText)
    .filter(Boolean);
};

const validJobStatuses: JobPostingStatus[] = [
  "draft",
  "published",
  "archived",
];
const validApplicationStatuses: JobApplicationStatus[] = [
  "received",
  "reviewing",
  "shortlisted",
  "rejected",
  "hired",
];

const buildJobPayload = (body: Record<string, unknown>) => {
  const status = cleanText(body.status) as JobPostingStatus;
  return {
    recordType: "career_job",
    slug:
      cleanText(body.slug) ||
      `career-${slugify(
        `${cleanText(body.title)}-${cleanText(body.location)}`,
      )}`,
    title: cleanText(body.title),
    department: cleanText(body.department),
    location: cleanText(body.location),
    experience: cleanText(body.experience),
    employmentType: cleanText(body.employmentType) || "Full Time",
    skills: parseList(body.skills),
    responsibilities: parseList(body.responsibilities),
    requirements: parseList(body.requirements),
    salaryRange: cleanText(body.salaryRange),
    status: validJobStatuses.includes(status) ? status : "draft",
    openingsCount: Math.max(Number(body.openingsCount) || 1, 1),
    applicationDeadline: cleanText(body.applicationDeadline)
      ? new Date(cleanText(body.applicationDeadline))
      : undefined,
    summary: cleanText(body.summary),
    priorityOrder: Number(body.priorityOrder) || 0,
  };
};

const extractResume = (body: Record<string, any>) => {
  const file = Array.isArray(body.resume) ? body.resume[0] : body.resume;
  if (!file) return undefined;
  if (typeof file === "string") return { url: file };
  return {
    url: cleanText(file.url),
    name: cleanText(file.name),
    originalname: cleanText(file.originalname),
    mimetype: cleanText(file.mimetype),
    size: Number(file.size) || undefined,
  };
};

export class CareerController {
  static async getPublishedJobs(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const now = new Date();
      const query: Record<string, unknown> = {
        recordType: "career_job",
        status: "published",
        $or: [
          { applicationDeadline: { $exists: false } },
          { applicationDeadline: null },
          { applicationDeadline: { $gte: now } },
        ],
      };
      if (req.query?.department) query.department = req.query.department;
      if (req.query?.location) query.location = req.query.location;

      const jobs = await JobPosting.find(query)
        .sort({ priorityOrder: 1, applicationDeadline: 1, createdAt: -1 })
        .lean();
      return res
        .status(200)
        .json(new ApiResponse(200, jobs, "Career jobs fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async getJobById(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await JobPosting.findOne({
        _id: req.params.id,
        recordType: "career_job",
        status: "published",
      }).lean();
      if (!job) return res.status(404).json(new ApiError(404, "Job not found"));
      return res.status(200).json(new ApiResponse(200, job, "Job fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async submitApplication(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const name = cleanText(req.body?.name);
      const email = cleanText(req.body?.email).toLowerCase();
      const phone = normalizeMobile(cleanText(req.body?.phone));

      if (!nameRegex.test(name)) {
        return res.status(400).json(new ApiError(400, "Enter a valid name"));
      }
      if (!emailRegex.test(email)) {
        return res.status(400).json(new ApiError(400, "Enter a valid email"));
      }
      if (!mobileRegex.test(phone)) {
        return res
          .status(400)
          .json(new ApiError(400, "Enter a valid mobile number"));
      }

      const jobId = cleanText(req.body?.jobId);
      const job = jobId
        ? ((await JobPosting.findOne({
            _id: jobId,
            recordType: "career_job",
          }).lean()) as any)
        : null;
      const jobTitle = cleanText(req.body?.jobTitle) || job?.title || "Open Role";

      const result = await JobApplication.create({
        recordType: "career_application",
        job: job?._id,
        jobTitle,
        name,
        email,
        phone,
        location: cleanText(req.body?.location),
        experience: cleanText(req.body?.experience),
        resume: extractResume(req.body || {}),
        coverLetter: cleanText(req.body?.coverLetter),
      });

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Application submitted"));
    } catch (err) {
      next(err);
    }
  }

  static async listJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const query: Record<string, unknown> = { recordType: "career_job" };
      if (req.query?.status) query.status = req.query.status;
      if (req.query?.department) query.department = req.query.department;
      const result = await JobPosting.find(query)
        .sort({ priorityOrder: 1, createdAt: -1 })
        .lean();
      return res.status(200).json(new ApiResponse(200, result, "Jobs fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async createJob(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = buildJobPayload(req.body || {});
      const result = await JobPosting.create(payload);
      return res.status(201).json(new ApiResponse(201, result, "Job created"));
    } catch (err) {
      next(err);
    }
  }

  static async updateJob(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = buildJobPayload(req.body || {});
      const result = await JobPosting.findOneAndUpdate(
        { _id: req.params.id, recordType: "career_job" },
        payload,
        {
          new: true,
          runValidators: true,
        },
      );
      if (!result) return res.status(404).json(new ApiError(404, "Job not found"));
      return res.status(200).json(new ApiResponse(200, result, "Job updated"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteJob(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await JobPosting.findOneAndDelete({
        _id: req.params.id,
        recordType: "career_job",
      });
      if (!result) return res.status(404).json(new ApiError(404, "Job not found"));
      return res.status(200).json(new ApiResponse(200, result, "Job deleted"));
    } catch (err) {
      next(err);
    }
  }

  static async publishJob(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await JobPosting.findOneAndUpdate(
        { _id: req.params.id, recordType: "career_job" },
        { status: "published" },
        { new: true, runValidators: true }
      );
      if (!result) return res.status(404).json(new ApiError(404, "Job not found"));
      return res.status(200).json(new ApiResponse(200, result, "Job published"));
    } catch (err) {
      next(err);
    }
  }

  static async archiveJob(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await JobPosting.findOneAndUpdate(
        { _id: req.params.id, recordType: "career_job" },
        { status: "archived" },
        { new: true, runValidators: true }
      );
      if (!result) return res.status(404).json(new ApiError(404, "Job not found"));
      return res.status(200).json(new ApiResponse(200, result, "Job archived"));
    } catch (err) {
      next(err);
    }
  }

  static async listApplications(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const query: Record<string, unknown> = {
        recordType: "career_application",
      };
      if (req.query?.status) query.status = req.query.status;
      if (req.query?.jobId) query.job = req.query.jobId;
      const result = await JobApplication.find(query)
        .populate("job", "title department location")
        .sort({ createdAt: -1 })
        .lean();
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Applications fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async updateApplicationStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const status = cleanText(req.body?.status) as JobApplicationStatus;
      if (!validApplicationStatuses.includes(status)) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid application status"));
      }
      const result = await JobApplication.findOneAndUpdate(
        { _id: req.params.id, recordType: "career_application" },
        { status, remarks: cleanText(req.body?.remarks) },
        { new: true, runValidators: true }
      );
      if (!result) {
        return res.status(404).json(new ApiError(404, "Application not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Application updated"));
    } catch (err) {
      next(err);
    }
  }
}
