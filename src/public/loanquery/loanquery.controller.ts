import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  LoanQuery,
  LoanType,
  allowedFieldsByFormType,
  LoanQueryActivityType,
} from "../../modals/loanquery.model";
import { ApplicationStatus } from "../../modals/insurancequery.model";
import LanderAssignmentEngine from "../../services/landerAssignment.service";
import { Types } from "mongoose";
import Lander from "../../modals/lander.model";
import { normalizeLoanType } from "../../utils/loanType";
import Admin from "../../modals/admin.model";
import {
  fetchSurepassRcDetails,
  fetchSurepassCibilReport,
  fetchSurepassCibilPdfReport,
  prepareSurepassCibilPayload,
  prepareSurepassRcPayload,
} from "../../services/surepass.service";
import { VehicleRcLookup } from "../../modals/vehicleRcLookup.model";
import { User } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import EmployeeAssignmentEngine from "../../services/employeeAssignment.service";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import {
  DEFAULT_QUERY_TIMEZONE,
  buildDateRangeInTimeZone,
} from "../../utils/helper";

const RC_CACHE_TTL_DAYS = 365;
const normalizeRcNumber = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const loanQueryService = new CommonService(LoanQuery);

const resolveDateRange = (startRaw: any, endRaw: any, days: number = 7) => {
  return buildDateRangeInTimeZone(
    startRaw,
    endRaw,
    days,
    DEFAULT_QUERY_TIMEZONE,
  );
};

const buildLoanScopeMatch = (userId: any, role?: string) => {
  const match: Record<string, any> = {};
  if (role === "agent") {
    const agentObjectId = toObjectId(userId);
    if (agentObjectId) {
      match.$or = [
        { assignedAgent: agentObjectId },
        { assignedAgents: agentObjectId },
      ];
    }
  } else if (role === "lander") {
    const landerObjectId = toObjectId(userId);
    if (landerObjectId) match.assignedLander = landerObjectId;
  } else if (role !== "admin" && userId) {
    match.customerId = userId;
  }
  return match;
};

const getIdString = (value: any): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value?._id) return String(value._id);
  return String(value);
};

const toObjectId = (value: any): Types.ObjectId | null => {
  const id = getIdString(value);
  if (!id) return null;
  try {
    return new Types.ObjectId(id);
  } catch {
    return null;
  }
};

const resolveAgencyAccessIds = async (
  userId: any,
  role?: string,
): Promise<Set<string>> => {
  const ids = new Set<string>();
  const actorId = getIdString(userId);
  if (!actorId) return ids;
  ids.add(actorId);

  if (role === "agency_member") {
    const self = await Agency.findById(actorId).select("parentAgency").lean();
    const parentAgencyId = getIdString((self as any)?.parentAgency);
    if (parentAgencyId) ids.add(parentAgencyId);
  }

  return ids;
};

const canAccessLoanQuery = async (
  query: any,
  userId: any,
  role?: string,
): Promise<boolean> => {
  if (role === "admin") return true;

  const actorId = getIdString(userId);
  if (!actorId) return false;

  if (role === "lander") {
    const assignedLanderId = getIdString(
      query?.assignedLander?._id || query?.assignedLander,
    );
    return assignedLanderId === actorId;
  }

  if (role === "agent") {
    return isAgentAssignedToQuery(query, actorId);
  }

  if (role === "agency" || role === "agency_member") {
    const allowedAgencyIds = await resolveAgencyAccessIds(actorId, role);

    const ownerAgencyId = getIdString(
      query?.ownerAgencyDetails?._id ||
        query?.ownerAgency?._id ||
        query?.ownerAgency,
    );
    const channelAgencyId = getIdString(
      query?.channelAgencyDetails?._id ||
        query?.channelAgency?._id ||
        query?.channelAgency,
    );

    if (ownerAgencyId && allowedAgencyIds.has(ownerAgencyId)) return true;
    if (channelAgencyId && allowedAgencyIds.has(channelAgencyId)) return true;

    // Backward compatibility: old records may only contain member in channelAgency.
    if (role === "agency" && channelAgencyId) {
      const channelAgency = await Agency.findById(channelAgencyId)
        .select("parentAgency")
        .lean();
      const parentId = getIdString((channelAgency as any)?.parentAgency);
      if (parentId && parentId === actorId) return true;
    }

    return false;
  }

  const customerOwnerId = getIdString(
    query?.customerIdDetails?._id ||
      query?.customerId?._id ||
      query?.customerId,
  );
  return customerOwnerId === actorId;
};

const sanitizeLoanQueryListItem = (item: any) => {
  if (!item || typeof item !== "object") return item;

  const policyDetails =
    item.policyDetails && typeof item.policyDetails === "object"
      ? Object.entries(item.policyDetails).reduce<Record<string, any>>(
          (acc, [key, value]) => {
            const normalizedKey = key.toLowerCase();
            if (
              normalizedKey === "coapplicants" ||
              normalizedKey.includes("file") ||
              normalizedKey.includes("document") ||
              normalizedKey.includes("attachment") ||
              normalizedKey.includes("upload") ||
              normalizedKey.endsWith("url") ||
              Array.isArray(value) ||
              (value && typeof value === "object")
            ) {
              return acc;
            }
            acc[key] = value;
            return acc;
          },
          {},
        )
      : item.policyDetails;

  const { documents, activities, rcLookup, ...rest } = item;
  return {
    ...rest,
    policyDetails,
  };
};

const loanQueryListFields = [
  "_id",
  "loanId",
  "loanType",
  "firstName",
  "lastName",
  "mobile",
  "email",
  "assignedAgent",
  "assignedAgents",
  "assignedLander",
  "status",
  "createdAt",
  "updatedAt",
  "city",
  "state",
  "employmentType",
  "monthlyIncome",
  "workExperience",
  "loanAmount",
  "approved",
  "policyDetails.propertyType",
  "policyDetails.propertyValue",
];

const resolveActivityActorModel = (
  role?: string,
): "Admin" | "Agent" | "Lander" | "User" => {
  if (role === "admin") return "Admin";
  if (role === "agent") return "Agent";
  if (role === "lander") return "Lander";
  return "User";
};

const collectAssignedAgentIds = (query: any) => {
  const ids = new Set<string>();
  const primaryAgentId = getIdString(
    query?.assignedAgent?._id || query?.assignedAgent,
  );
  if (primaryAgentId) ids.add(primaryAgentId);

  const assignedAgents = Array.isArray(query?.assignedAgents)
    ? query.assignedAgents
    : [];
  for (const agent of assignedAgents) {
    const agentId = getIdString(agent?._id || agent);
    if (agentId) ids.add(agentId);
  }

  return Array.from(ids);
};

const isAgentAssignedToQuery = (query: any, actorId: any) => {
  const agentId = getIdString(actorId);
  if (!agentId) return false;
  return collectAssignedAgentIds(query).includes(agentId);
};

const enrichActivityActors = async (activities: any[] = []) => {
  if (!Array.isArray(activities) || activities.length === 0) return activities;

  const actorBuckets = {
    Admin: new Set<string>(),
    Agent: new Set<string>(),
    Lander: new Set<string>(),
    User: new Set<string>(),
  } as Record<"Admin" | "Agent" | "Lander" | "User", Set<string>>;

  for (const activity of activities) {
    const actorId = getIdString(activity?.actor);
    const actorModel = activity?.actorModel || "User";
    if (actorId && actorBuckets[actorModel as keyof typeof actorBuckets]) {
      actorBuckets[actorModel as keyof typeof actorBuckets].add(actorId);
    }
  }

  const [admins, agents, landers, users] = await Promise.all([
    actorBuckets.Admin.size
      ? Admin.find({ _id: { $in: Array.from(actorBuckets.Admin) } })
          .select("_id name username email")
          .lean()
      : Promise.resolve([]),
    actorBuckets.Agent.size
      ? Admin.find({ _id: { $in: Array.from(actorBuckets.Agent) } })
          .select("_id name username email")
          .lean()
      : Promise.resolve([]),
    actorBuckets.Lander.size
      ? Lander.find({ _id: { $in: Array.from(actorBuckets.Lander) } })
          .select("_id name email")
          .lean()
      : Promise.resolve([]),
    actorBuckets.User.size
      ? User.find({ _id: { $in: Array.from(actorBuckets.User) } })
          .select("_id name email mobile")
          .lean()
      : Promise.resolve([]),
  ]);

  const lookup = new Map<string, any>();
  [...admins, ...agents, ...landers, ...users].forEach((actor: any) => {
    if (!actor?._id) return;
    lookup.set(String(actor._id), actor);
  });

  return activities.map((activity) => {
    const actor = lookup.get(getIdString(activity?.actor));
    return {
      ...activity,
      actorName:
        actor?.name || actor?.username || actor?.email || activity?.actorName,
      actorEmail: actor?.email || activity?.actorEmail || "",
    };
  });
};

// Helper function to extract URL from uploaded file object
const extractFileUrl = (file: any): string | undefined => {
  if (!file) return undefined;
  if (typeof file === "string") return file;
  if (Array.isArray(file) && file.length > 0) {
    return file[0]?.url || file[0];
  }
  return file.url || file;
};

const extractFileUrls = (file: any): string[] => {
  if (!file) return [];
  if (typeof file === "string") return [file];
  if (Array.isArray(file)) {
    return file.map((item) => item?.url || item).filter(Boolean);
  }
  if (file.url) return [file.url];
  return [];
};

const parseMaybeJson = (value: any) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const normalizeUploadedAttachment = (value: any) => {
  const parsed = parseMaybeJson(value);
  if (!parsed) return null;

  if (typeof parsed === "string") {
    return { url: parsed };
  }

  if (typeof parsed !== "object") {
    return null;
  }

  const url =
    parsed.url ||
    parsed.fileUrl ||
    parsed.dataUrl ||
    parsed.preview ||
    parsed.link ||
    parsed.path;

  if (!url) {
    return null;
  }

  return {
    ...parsed,
    url,
    name:
      parsed.name ||
      parsed.originalname ||
      parsed.fileName ||
      parsed.label ||
      parsed.filename ||
      undefined,
  };
};

const normalizeCoApplicants = (value: any) => {
  const parsed = parseMaybeJson(value);
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  return list
    .map((item) => {
      const coApplicant = parseMaybeJson(item);
      if (!coApplicant || typeof coApplicant !== "object") return null;
      return {
        ...coApplicant,
        aadhaarFile: normalizeUploadedAttachment(coApplicant.aadhaarFile),
        panFile: normalizeUploadedAttachment(coApplicant.panFile),
        bankStatementFile: normalizeUploadedAttachment(
          coApplicant.bankStatementFile,
        ),
      };
    })
    .filter(Boolean);
};

// Helper function to process uploaded files and map to request body
const processFileUploads = (req: Request) => {
  // Initialize policyDetails if it doesn't exist
  req.body.policyDetails = parseMaybeJson(req.body.policyDetails) || {};
  if (!req.body.policyDetails) {
    req.body.policyDetails = {};
  }

  // Initialize documents if it doesn't exist
  req.body.documents = parseMaybeJson(req.body.documents) || {};
  if (!req.body.documents) {
    req.body.documents = {};
  }

  if (req.body.policyDetails?.coApplicants) {
    req.body.policyDetails.coApplicants = normalizeCoApplicants(
      req.body.policyDetails.coApplicants,
    );
  }

  // Process bankStatementUrl (main field)
  if (req.body.bankStatementUrl) {
    const url = extractFileUrl(req.body.bankStatementUrl);
    if (url) req.body.bankStatementUrl = url;
  }

  // Get allowed fields for this loan type (if loanType is provided)
  const loanType = req.body.loanType;
  const allowedFields = loanType ? allowedFieldsByFormType[loanType] || [] : [];

  // Process policyDetails document fields (uploaded files/images)
  // These are URL fields that go into policyDetails
  const policyDetailsDocumentFields = [
    "salarySlipUrl",
    "admissionLetterUrl",
    "feeStructureUrl",
    "rcCopyUrl",
    "goldPhotosUrl",
    "carInsuranceUrl",
    "lastMonthBankStatementUrl",
    "propertyDocumentsUrl",
    "propertyOwnershipProofUrl",
    "renovationEstimateUrl",
    "itrUrl",
    "gstReturnsUrl",
    "dematStatementOrFdCopyUrl",
    "proformaInvoiceOrQuotationUrl",
    "businessRegistrationCertificateUrl",
  ];

  policyDetailsDocumentFields.forEach((field) => {
    // Only process if field is allowed for this loan type (or if loanType is not set yet)
    if (req.body[field] && (!loanType || allowedFields.includes(field))) {
      const url = extractFileUrl(req.body[field]);
      if (url) {
        req.body.policyDetails[field] = url;
      }
      // Remove from body after processing
      delete req.body[field];
    }
  });

  // Process documents field - these are uploaded as separate fields and mapped to documents object
  // Document types from AllowedDocumentType enum
  const documentTypes = [
    "pan_card",
    "aadhaar_card",
    "photo",
    "itr_form_16",
    "salary_slip",
    "offer_letter",
    "relieving_letter",
    "bank_statement",
    "gst_certificate",
    "gst_returns",
    "shop_act",
    "govt_license",
  ];

  documentTypes.forEach((docType) => {
    if (req.body[docType]) {
      const url = extractFileUrl(req.body[docType]);
      if (url) {
        req.body.documents[docType] = url;
      }
      // Remove from body after processing
      delete req.body[docType];
    }
  });
};

const normalizeAccountType = (value?: string) => {
  if (!value) return value;
  const normalized = value.toString().trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  if (
    ["saving", "savings", "savingaccount", "savingsaccount"].includes(compact)
  )
    return "savings";
  if (["current", "currentaccount"].includes(compact)) return "current";
  if (["salary", "salaryaccount"].includes(compact)) return "salary";
  return normalized;
};

export class LoanQueryController {
  static async fetchRcDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const payload = prepareSurepassRcPayload(req.body || {});
      const idNumber = normalizeRcNumber(payload.id_number);
      const now = new Date();
      const cached = await VehicleRcLookup.findOne({ idNumber }).lean();
      if (cached?.fetchedAt) {
        const ageMs = now.getTime() - new Date(cached.fetchedAt).getTime();
        const maxAgeMs = RC_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
        if (ageMs < maxAgeMs) {
          const accessUpdate: any = {
            $set: { lastAccessedAt: now },
            $inc: { accessCount: 1 },
          };
          if (userId) {
            accessUpdate.$set.lastAccessedBy = userId;
          }
          await VehicleRcLookup.updateOne({ _id: cached._id }, accessUpdate);
          return res.status(200).json(
            new ApiResponse(
              200,
              {
                environment: cached.environment,
                data: cached.report,
                cached: true,
                lastFetchedAt: cached.fetchedAt,
              },
              "RC details fetched successfully",
            ),
          );
        }
      }

      const result = await fetchSurepassRcDetails(payload);
      const update: any = {
        $set: {
          idNumber,
          report: result.data,
          payload,
          environment: result.environment,
          fetchedAt: now,
          lastAccessedAt: now,
        },
        $inc: { accessCount: 1, fetchCount: 1 },
      };
      if (userId) {
        update.$set.lastFetchedBy = userId;
        update.$set.lastAccessedBy = userId;
      }
      await VehicleRcLookup.findOneAndUpdate({ idNumber }, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { ...result, cached: false, lastFetchedAt: now },
            "RC details fetched successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async fetchCibilForQuery(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { role, _id } = (req as any).user || {};
      if (!["admin", "agent", "lander"].includes(role)) {
        return res
          .status(403)
          .json(new ApiError(403, "You are not allowed to fetch CIBIL here"));
      }

      const query = await LoanQuery.findById(req.params.id).lean();
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (
        role === "lander" &&
        query.assignedLander?.toString() !== String(_id)
      ) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only fetch CIBIL for queries assigned to you",
            ),
          );
      }

      const user = await User.findById(query.customerId);
      if (!user) {
        return res.status(404).json(new ApiError(404, "User not found"));
      }

      const { forceRefresh = false, environment } = req.body || {};
      const now = new Date();
      const lastFetched = user.cibilLastFetchedAt
        ? new Date(user.cibilLastFetchedAt)
        : null;
      const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
      const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
      const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
      const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
      const cachedReport = (user as any)?.cibilReport || null;
      const cachedPayload = (user as any)?.cibilRequestPayload || null;

      if (!forceRefresh && cachedReport && refreshLocked) {
        return res.status(200).json(
          new ApiResponse(200, {
            cached: true,
            report: cachedReport,
            payload: cachedPayload,
            cibilScore: user.cibilScore,
            refreshAvailableInDays: daysRemaining,
            lastFetchedAt: user.cibilLastFetchedAt,
            message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
          }),
        );
      }

      const payload = prepareSurepassCibilPayload({
        name: req.body?.name || req.body?.fullName || user.name,
        panNumber: req.body?.panNumber || user.panCard,
        mobile: req.body?.mobile || user.mobile,
        gender:
          req.body?.gender || (user.gender === "female" ? "female" : "male"),
        consent: req.body?.consent || "Y",
      });

      const report = await fetchSurepassCibilReport(payload, {
        environment:
          environment === "production"
            ? "production"
            : environment === "sandbox"
              ? "sandbox"
              : undefined,
      });
      const score =
        report.data?.score ||
        report.data?.cibil_score ||
        report.data?.data?.score ||
        null;

      user.cibilScore = score || user.cibilScore;
      user.cibilLastFetchedAt = now;
      (user as any).cibilReport = report.data;
      (user as any).cibilRequestPayload = payload;
      await user.save();

      return res.status(200).json(
        new ApiResponse(200, {
          payload,
          environment: report.environment,
          report: report.data,
          ...(score ? { cibilScore: score } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  static async fetchCibilForPerson(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { role } = (req as any).user || {};
      if (!["admin", "agent", "lander"].includes(role)) {
        return res
          .status(403)
          .json(new ApiError(403, "You are not allowed to fetch CIBIL here"));
      }

      const { name, panNumber, mobile, gender, environment, consent } =
        req.body || {};
      if (!mobile && !panNumber && !name) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "At least one identifier (mobile/pan/name) is required",
            ),
          );
      }

      const payload = prepareSurepassCibilPayload({
        name: name || undefined,
        panNumber: panNumber || undefined,
        mobile: mobile || undefined,
        gender: gender || undefined,
        consent: consent || "Y",
      });

      const report = await fetchSurepassCibilReport(payload, {
        environment:
          environment === "production"
            ? "production"
            : environment === "sandbox"
              ? "sandbox"
              : undefined,
      });

      const score =
        report.data?.score ||
        report.data?.cibil_score ||
        report.data?.data?.score ||
        null;

      return res.status(200).json(
        new ApiResponse(200, {
          payload,
          environment: report.environment,
          report: report.data,
          ...(score ? { cibilScore: score } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  static async fetchCibilPdfByMobile(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { role } = (req as any).user || {};
      if (!["admin", "agent", "lander"].includes(role)) {
        return res
          .status(403)
          .json(
            new ApiError(403, "You are not allowed to fetch CIBIL PDF here"),
          );
      }

      const { mobile } = req.body || {};

      if (!mobile) {
        return res
          .status(400)
          .json(new ApiError(400, "Mobile number is required"));
      }

      // Normalize mobile number
      const normalizedMobile = mobile.replace(/\D/g, "");

      // Find user by mobile number
      const user = await User.findOne({ mobile: normalizedMobile });
      if (!user) {
        return res
          .status(404)
          .json(new ApiError(404, "User not found with this mobile number"));
      }

      const { forceRefresh = false } = req.body || {};
      const now = new Date();
      const lastFetched = user.cibilPdfLastFetchedAt
        ? new Date(user.cibilPdfLastFetchedAt)
        : null;
      const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
      const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
      const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
      const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
      const cachedReport = (user as any)?.cibilPdfReport || null;
      const cachedLink =
        cachedReport?.data?.credit_report_link ||
        cachedReport?.data?.creditReportLink ||
        cachedReport?.credit_report_link ||
        cachedReport?.creditReportLink ||
        null;

      if (!forceRefresh && cachedLink && refreshLocked) {
        return res.status(200).json(
          new ApiResponse(200, {
            cached: true,
            report: cachedReport,
            refreshAvailableInDays: daysRemaining,
            lastFetchedAt: user.cibilPdfLastFetchedAt,
            message: `CIBIL PDF can be refreshed again in ${daysRemaining} day(s).`,
          }),
        );
      }

      const payload = prepareSurepassCibilPayload({
        name: user.name,
        mobile: user.mobile,
        panCard: user.panCard,
        gender: user.gender === "female" ? "female" : "male",
        consent: "Y",
      });

      const report = await fetchSurepassCibilPdfReport(payload, {
        environment: "production",
      });

      user.cibilPdfLastFetchedAt = now;
      (user as any).cibilPdfReport = report.data;
      await user.save();

      return res.status(200).json(
        new ApiResponse(200, {
          payload,
          cached: false,
          report: report.data,
          environment: report.environment,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilPdfLastFetchedAt,
          message: `CIBIL PDF can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  static async createQuery(req: Request, res: Response, next: NextFunction) {
    try {
      // Get customer ID from authenticated user token
      const customerId = (req as any).user?._id;
      const role = (req as any).user?.role;
      if (!customerId) {
        return res
          .status(401)
          .json(new ApiError(401, "User authentication required"));
      }

      const normalizedLoanType = normalizeLoanType(req.body.loanType);
      if (normalizedLoanType) req.body.loanType = normalizedLoanType;

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Automatically set customerId from token
      req.body.customerId = customerId;
      if (role === "agency" || role === "agency_member") {
        req.body.channelAgency = customerId;
        if (role === "agency_member") {
          const agency = await Agency.findById(customerId)
            .select("parentAgency")
            .lean();
          req.body.ownerAgency = agency?.parentAgency || customerId;
        } else {
          req.body.ownerAgency = customerId;
        }
      }
      if (req.body.accountType) {
        req.body.accountType = normalizeAccountType(req.body.accountType);
      }
      if (req.body.policyDetails?.coApplicants) {
        const list = Array.isArray(req.body.policyDetails.coApplicants)
          ? req.body.policyDetails.coApplicants
          : [req.body.policyDetails.coApplicants];
        req.body.policyDetails.coApplicants = list.filter(Boolean);
      }

      // Validate policyDetails against loanType if both are provided (skip for draft)
      // This must run AFTER processFileUploads since files are moved to policyDetails
      const isDraft = req.body.status === ApplicationStatus.DRAFT;
      if (
        !isDraft &&
        req.body.loanType &&
        req.body.policyDetails &&
        Object.keys(req.body.policyDetails).length > 0
      ) {
        const allowed = allowedFieldsByFormType[req.body.loanType] || [];
        const invalidFields = Object.keys(req.body.policyDetails).filter(
          (field) => !allowed.includes(field),
        );
        if (invalidFields.length > 0) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                `Field(s) "${invalidFields.join(
                  ", ",
                )}" is/are not allowed for ${
                  req.body.loanType
                }. Allowed fields: ${allowed.join(", ")}`,
              ),
            );
        }
      }

      // Check if user already has an active loan query with the same loanType
      // User can only have one loanType until status is completed/approved/cancelled
      if (req.body.loanType) {
        const existingQuery = await LoanQuery.findOne({
          customerId: customerId,
          loanType: req.body.loanType,
          status: {
            $nin: [
              ApplicationStatus.COMPLETED,
              ApplicationStatus.APPROVED,
              ApplicationStatus.CANCELLED,
            ],
          },
        });

        if (existingQuery) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                `You already have an active ${req.body.loanType} loan query. Please complete, approve, or cancel the existing query before creating a new one.`,
              ),
            );
        }
      }

      // If status is draft, skip all required field validations
      let result;
      if (isDraft) {
        // For draft status, create without validation
        const draftData = { ...req.body };
        // Ensure status is set to draft
        draftData.status = ApplicationStatus.DRAFT;
        // Initialize activities array
        draftData.activities = [];
        // Create document without running validators
        result = new LoanQuery(draftData);
        await result.save({ validateBeforeSave: false });

        // Add created activity
        result.activities = result.activities || [];
        result.activities.push({
          type: LoanQueryActivityType.CREATED,
          description: "Loan query created as draft",
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: "User",
          createdAt: new Date(),
        });
        await result.save({ validateBeforeSave: false });
      } else {
        // For non-draft status, use normal validation
        const createData = { ...req.body, activities: [] };
        result = await loanQueryService.create(createData);

        // Add created activity
        result.activities = result.activities || [];
        result.activities.push({
          type: LoanQueryActivityType.CREATED,
          description: "Loan query created",
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: "User",
          createdAt: new Date(),
        });

        const session = (req as any).mongoSession;

        // Auto-assign employee (from Admin model with role=agent)
        if (result && !result.assignedAgent) {
          result = await EmployeeAssignmentEngine.ensureAssignmentForLoanQuery(
            result,
            {
              actorId: customerId?.toString(),
              actorModel: "User",
              reason: "new_loan_query",
              session,
            },
          );
        }

        // Auto-assign lander if not already assigned
        if (result && !result.assignedLander) {
          result = await LanderAssignmentEngine.ensureAssignment(result, {
            actorId: customerId?.toString(),
            reason: "new_loan_query",
            session,
          });
        }
        await result.save({ session });
      }

      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create loan query"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Loan query created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createAgencyQuery(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const role = (req as any).user?.role;
    if (role !== "agency" && role !== "agency_member") {
      return res
        .status(403)
        .json(
          new ApiError(
            403,
            "Only agency or agency member can use this endpoint",
          ),
        );
    }
    return LoanQueryController.createQuery(req, res, next);
  }

  static async getAllQueries(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const requiresStatus =
        role === "admin" || role === "agent" || role === "lander";
      if (req.query.status === "all") {
        delete req.query.status;
      } else if (requiresStatus && !req.query.status) {
        req.query.status = ApplicationStatus.SUBMITTED;
      }

      if (req.query.loanType) {
        const normalized = normalizeLoanType(String(req.query.loanType));
        if (normalized) req.query.loanType = normalized;
      }

      const prependStages: any[] = [];

      // For agents, show queries assigned to them either as primary or secondary assignee
      if (role === "agent" && userId) {
        const agentObjectId = toObjectId(userId);
        if (agentObjectId) {
          prependStages.push({
            $match: {
              $or: [
                { assignedAgent: agentObjectId },
                { assignedAgents: agentObjectId },
              ],
            },
          });
        }
      }
      // For landers, only show queries assigned to them
      else if (role === "lander" && userId) {
        req.query.assignedLander = userId;
      }
      // For non-admin, non-agent, non-lander users, only show their own queries
      else if (role !== "admin" && userId) {
        req.query.customerId = userId;
      }

      // Handle status filtering
      // If status is explicitly provided, use it; otherwise exclude draft queries
      // if (!req.query.status) {
      //   req.query.status = { $ne: ApplicationStatus.DRAFT };
      // }

      // Add lookup stages to populate assignedAgent and assignedLander
      const populateStages = [
        {
          $lookup: {
            from: "admins",
            localField: "assignedAgent",
            foreignField: "_id",
            as: "assignedAgentData",
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "assignedAgents",
            foreignField: "_id",
            as: "assignedAgentsData",
          },
        },
        {
          $unwind: {
            path: "$assignedAgentData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "landers",
            localField: "assignedLander",
            foreignField: "_id",
            as: "assignedLanderData",
          },
        },
        {
          $unwind: {
            path: "$assignedLanderData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            assignedAgent: {
              $cond: {
                if: { $ifNull: ["$assignedAgentData", false] },
                then: {
                  _id: "$assignedAgentData._id",
                  name: {
                    $ifNull: [
                      "$assignedAgentData.name",
                      "$assignedAgentData.username",
                    ],
                  },
                  email: "$assignedAgentData.email",
                  mobile: "$assignedAgentData.mobile",
                },
                else: "$assignedAgent",
              },
            },
            assignedAgents: {
              $cond: {
                if: {
                  $gt: [
                    {
                      $size: {
                        $ifNull: ["$assignedAgentsData", []],
                      },
                    },
                    0,
                  ],
                },
                then: "$assignedAgentsData",
                else: { $ifNull: ["$assignedAgents", []] },
              },
            },
            assignedLander: {
              $cond: {
                if: { $ifNull: ["$assignedLanderData", false] },
                then: {
                  _id: "$assignedLanderData._id",
                  name: "$assignedLanderData.name",
                  email: "$assignedLanderData.email",
                  mobile: "$assignedLanderData.mobile",
                },
                else: "$assignedLander",
              },
            },
          },
        },
        {
          $project: {
            assignedAgentData: 0,
            assignedAgentsData: 0,
            assignedLanderData: 0,
          },
        },
      ];

      const loanQueries = await loanQueryService.getAll(
        {
          ...req.query,
          fields: (req.query.fields as string) || loanQueryListFields.join(","),
        },
        populateStages,
        {
          prependStages,
          lookupsInDataFacet: true,
        },
      );
      const sanitizedLoanQueries = Array.isArray(loanQueries)
        ? loanQueries.map(sanitizeLoanQueryListItem)
        : loanQueries &&
            typeof loanQueries === "object" &&
            Array.isArray((loanQueries as any).result)
          ? {
              ...(loanQueries as any),
              result: (loanQueries as any).result.map(
                sanitizeLoanQueryListItem,
              ),
            }
          : loanQueries;
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            sanitizedLoanQueries,
            "Loan queries fetched successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { loanType, startDate, endDate } = req.query as Record<
        string,
        string
      >;

      const normalizedLoanType = loanType
        ? normalizeLoanType(String(loanType))
        : "";
      if (loanType && !normalizedLoanType) {
        return res.status(400).json(new ApiError(400, "Invalid loanType"));
      }

      const { start, end } = resolveDateRange(startDate, endDate, 7);

      const match: Record<string, any> = {
        createdAt: { $gte: start, $lte: end },
      };

      if (normalizedLoanType) {
        match.loanType = normalizedLoanType;
      }

      Object.assign(match, buildLoanScopeMatch(userId, role));

      const rows = await LoanQuery.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            amount: { $sum: { $ifNull: ["$loanAmount", 0] } },
          },
        },
      ]);

      const byStatus: Record<string, number> = {};
      const amountByStatus: Record<string, number> = {};
      let total = 0;
      let totalAmount = 0;

      rows.forEach((row: any) => {
        const key = row?._id ? String(row._id) : "unknown";
        const count = Number(row?.count) || 0;
        const amount = Number(row?.amount) || 0;
        byStatus[key] = count;
        amountByStatus[key] = amount;
        total += count;
        totalAmount += amount;
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            loanType: normalizedLoanType || "all",
            range: {
              startDate: start.toISOString(),
              endDate: end.toISOString(),
            },
            total,
            totalAmount,
            byStatus,
            amountByStatus,
          },
          "Loan query stats fetched successfully",
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  static async getSidebarCounts(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const match = buildLoanScopeMatch(userId, role);
      const rows = await LoanQuery.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$loanType",
            count: { $sum: 1 },
          },
        },
      ]);

      const byType: Record<string, number> = Object.values(LoanType).reduce(
        (acc, type) => {
          acc[type] = 0;
          return acc;
        },
        {} as Record<string, number>,
      );

      let total = 0;
      rows.forEach((row: any) => {
        const key =
          normalizeLoanType(String(row?._id || "")) || String(row?._id || "");
        const count = Number(row?.count) || 0;
        if (key && Object.prototype.hasOwnProperty.call(byType, key)) {
          byType[key] += count;
        }
        total += count;
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            total,
            byType,
          },
          "Loan query sidebar counts fetched successfully",
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  static async getQueryById(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const result = await loanQueryService.getById(
        req.params.id,
        role !== "admin",
      );

      // Ensure user can only view their own queries (unless admin)
      if (!(await canAccessLoanQuery(result, customerId, role))) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only view your own loan queries"));
      }

      if (result?.status !== ApplicationStatus.DRAFT) {
        return res
          .status(404)
          .json(new ApiError(404, "Only draft queries can be fetched"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan query fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateQueryById(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const customerId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      if (req.body.loanType) {
        const normalized = normalizeLoanType(req.body.loanType);
        if (normalized) req.body.loanType = normalized;
      }

      //only draft queries can be updated
      const existingResult = await loanQueryService.getById(
        req.params.id,
        true,
      );
      if (existingResult?.status !== ApplicationStatus.DRAFT) {
        return res
          .status(400)
          .json(new ApiError(400, "Only draft queries can be updated"));
      }

      // Ensure user can only update their own queries (unless admin)
      if (!(await canAccessLoanQuery(existingResult, customerId, role))) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update your own loan queries"));
      }

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Prevent changing customerId
      delete req.body.customerId;
      if (req.body.accountType) {
        req.body.accountType = normalizeAccountType(req.body.accountType);
      }

      // Merge with existing policyDetails if updating
      if (req.body.policyDetails && existingResult.policyDetails) {
        req.body.policyDetails = {
          ...existingResult.policyDetails,
          ...req.body.policyDetails,
        };
      }

      if (req.body.policyDetails?.coApplicants) {
        req.body.policyDetails.coApplicants = normalizeCoApplicants(
          req.body.policyDetails.coApplicants,
        );
      }

      // Merge with existing documents if updating
      if (req.body.documents && existingResult.documents) {
        req.body.documents = {
          ...existingResult.documents,
          ...req.body.documents,
        };
      }

      const updatedResult = await loanQueryService.updateById(
        req.params.id,
        req.body,
        {
          populate: true,
        },
      );

      // Track status change
      if (updatedResult && existingResult?.status !== updatedResult.status) {
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: LoanQueryActivityType.STATUS_CHANGED,
          description: `Status changed from ${existingResult?.status} to ${updatedResult.status}`,
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: role === "admin" ? "Admin" : "User",
          payload: {
            previousStatus: existingResult?.status,
            newStatus: updatedResult.status,
          },
          createdAt: new Date(),
        });
      } else {
        // Track update if status didn't change
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: LoanQueryActivityType.UPDATED,
          description: "Loan query updated",
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: role === "admin" ? "Admin" : "User",
          createdAt: new Date(),
        });
      }

      // Auto-assign employee if status changed from draft to non-draft and no employee assigned
      if (
        updatedResult &&
        existingResult?.status === ApplicationStatus.DRAFT &&
        updatedResult.status !== ApplicationStatus.DRAFT &&
        !updatedResult.assignedAgent
      ) {
        const session = (req as any).mongoSession;
        await EmployeeAssignmentEngine.ensureAssignmentForLoanQuery(
          updatedResult as any,
          {
            actorId: customerId?.toString(),
            actorModel: role === "admin" ? "Admin" : "User",
            reason: "draft_submitted",
            session,
          },
        );
      }

      // Auto-assign lander if status changed from draft to non-draft and no lander assigned
      if (
        updatedResult &&
        existingResult?.status === ApplicationStatus.DRAFT &&
        updatedResult.status !== ApplicationStatus.DRAFT &&
        !updatedResult.assignedLander
      ) {
        const session = (req as any).mongoSession;
        const result = await LanderAssignmentEngine.ensureAssignment(
          updatedResult,
          {
            actorId: customerId?.toString(),
            reason: "draft_submitted",
            session,
          },
        );
        await result.save({ session });
        if (
          existingResult?.status !== result.status &&
          result.status === ApplicationStatus.DISBURSED
        ) {
          await agencyEarningsService.recordLoanDisbursalCommission(
            result,
            customerId?.toString(),
          );
        }
        return res
          .status(200)
          .json(
            new ApiResponse(200, result, "Loan query updated successfully"),
          );
      }

      await updatedResult.save();
      if (
        existingResult?.status !== updatedResult.status &&
        updatedResult.status === ApplicationStatus.DISBURSED
      ) {
        await agencyEarningsService.recordLoanDisbursalCommission(
          updatedResult,
          customerId?.toString(),
        );
      }
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedResult,
            "Loan query updated successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async deleteQueryById(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await loanQueryService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete loan query"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Loan query deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async assignLander(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const { landerId } = req.body;

      // Only admin can assign landers
      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can assign landers"));
      }

      if (!landerId) {
        return res.status(400).json(new ApiError(400, "Lander ID is required"));
      }

      // Check if query exists
      const existingResult = await loanQueryService.getById(
        req.params.id,
        true,
      );
      if (!existingResult) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Get lander information for activity
      const lander = await Lander.findById(landerId).select("name email");
      if (!lander) {
        return res.status(404).json(new ApiError(404, "Lander not found"));
      }

      const actorId = (req as any).user?._id;
      const previousLanderId = existingResult.assignedLander;

      // Update assignedLander and add activity
      const updatedResult = await loanQueryService.updateById(
        req.params.id,
        {
          assignedLander: landerId,
          $push: {
            activities: {
              type: LoanQueryActivityType.LANDER_ASSIGNED,
              description: `Lander assigned: ${lander.name}${
                previousLanderId ? " (reassigned)" : ""
              }`,
              actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
              actorModel: "Admin",
              payload: {
                landerId: landerId,
                landerName: lander.name,
                previousLanderId: previousLanderId
                  ? String(previousLanderId)
                  : undefined,
                mode: "manual",
              },
              createdAt: new Date(),
            },
          },
        },
        {
          populate: [{ path: "assignedLander", select: "name email mobile" }],
        },
      );

      // Adjust lander load if needed
      if (
        previousLanderId &&
        previousLanderId.toString() !== landerId.toString()
      ) {
        await LanderAssignmentEngine.adjustLanderLoad(previousLanderId, -1);
      }
      await LanderAssignmentEngine.adjustLanderLoad(
        new Types.ObjectId(landerId),
        1,
      );

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedResult, "Lander assigned successfully"),
        );
    } catch (err) {
      next(err);
    }
  }

  static async assignAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const incomingAgentIds: string[] = Array.isArray(req.body?.agentIds)
        ? req.body.agentIds
        : req.body?.agentId
          ? [req.body.agentId]
          : [];
      const selectedAgentIds: string[] = Array.from(
        new Set(
          incomingAgentIds
            .map((value: any) => String(value || "").trim())
            .filter(Boolean),
        ),
      );

      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can assign agents"));
      }

      if (selectedAgentIds.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "At least one agent ID is required"));
      }

      if (selectedAgentIds.length > 10) {
        return res
          .status(400)
          .json(new ApiError(400, "You can assign up to 10 agents only"));
      }

      const existingResult = await LoanQuery.findById(req.params.id)
        .populate("assignedAgent", "name username email mobile")
        .populate("assignedAgents", "name username email mobile")
        .lean();
      if (!existingResult) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      const agents = await Admin.find({ _id: { $in: selectedAgentIds } })
        .populate("role")
        .select("_id name username email mobile role")
        .lean();

      if (agents.length !== selectedAgentIds.length) {
        return res
          .status(404)
          .json(new ApiError(404, "One or more agents were not found"));
      }

      const invalidAgent = agents.find(
        (agent: any) => (agent as any)?.role?.name !== "agent",
      );
      if (invalidAgent) {
        return res
          .status(400)
          .json(new ApiError(400, "Selected employee is not an agent"));
      }

      const actorId = (req as any).user?._id;
      const previousAgentIds: string[] =
        collectAssignedAgentIds(existingResult);
      const nextAgentIds: string[] = selectedAgentIds;
      const addedAgentIds: string[] = nextAgentIds.filter(
        (id) => !previousAgentIds.includes(id),
      );
      const removedAgentIds: string[] = previousAgentIds.filter(
        (id) => !nextAgentIds.includes(id),
      );
      const primaryAgentId = nextAgentIds[0];
      const agentNames: string[] = agents
        .map((agent: any) => agent?.name || agent?.username || agent?.email)
        .filter(Boolean);

      const updatedResult = await loanQueryService.updateById(
        req.params.id,
        {
          assignedAgent: primaryAgentId,
          assignedAgents: nextAgentIds,
          $push: {
            activities: {
              type: LoanQueryActivityType.AGENT_ASSIGNED,
              description: `Agent${nextAgentIds.length > 1 ? "s" : ""} assigned: ${agentNames.join(", ")}${
                previousAgentIds.length ? " (updated)" : ""
              }`,
              actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
              actorModel: "Admin",
              payload: {
                agentIds: nextAgentIds,
                agentNames,
                previousAgentIds,
                addedAgentIds,
                removedAgentIds,
                mode: "manual",
              },
              createdAt: new Date(),
            },
          },
        },
        {
          populate: [
            { path: "assignedAgent", select: "name username email mobile" },
            {
              path: "assignedAgents",
              select: "name username email mobile",
            },
          ],
        },
      );

      await Promise.all(
        removedAgentIds.map((agentId) =>
          EmployeeAssignmentEngine.adjustEmployeeLoad(agentId, -1),
        ),
      );
      await Promise.all(
        addedAgentIds.map((agentId) =>
          EmployeeAssignmentEngine.adjustEmployeeLoad(agentId, 1),
        ),
      );

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedResult, "Agent assigned successfully"),
        );
    } catch (err) {
      next(err);
    }
  }

  // ====== DETAIL VIEW AND OPERATIONS FOR ADMIN PANEL ======

  static async getQueryDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await LoanQuery.findById(req.params.id)
        .select("-activities -documents -rcLookup -policyDetails.coApplicants")
        .populate(
          "customerId",
          "name email mobile profilePictureUrl cibilScore cibilLastFetchedAt cibilPdfLastFetchedAt",
        )
        .populate(
          "assignedAgent",
          "name username email mobile profilePictureUrl",
        )
        .populate(
          "assignedAgents",
          "name username email mobile profilePictureUrl",
        )
        .populate("assignedLander", "name email mobile profilePictureUrl")
        .lean();

      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, userId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only view details of queries created or assigned to you",
            ),
          );
      }

      // Ensure commission fields are always present (for backward compatibility with old documents)
      const responseData = {
        ...query,
        commissionRecorded: query.commissionRecorded ?? false,
        commissionRecordedAt: query.commissionRecordedAt ?? null,
        commissionTransactionId: query.commissionTransactionId ?? null,
      };

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            responseData,
            "Loan query details fetched successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async getQueryDetailExtras(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await LoanQuery.findById(req.params.id)
        .select("activities rcLookup customerId policyDetails.coApplicants policyDetails.carRegistrationNumber policyDetails.carRegistrationNo")
        .lean();

      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, userId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only view details of queries created or assigned to you",
            ),
          );
      }

      const customerId = getIdString(
        (query as any)?.customerId?._id || query?.customerId,
      );
      const customer = customerId
        ? await User.findById(customerId)
            .select(
              "cibilScore cibilLastFetchedAt cibilReport cibilRequestPayload cibilPdfLastFetchedAt cibilPdfReport digiLockerVault",
            )
            .lean()
        : null;

      const rcNumberCandidate =
        (query as any)?.rcLookup?.idNumber ||
        (query as any)?.policyDetails?.carRegistrationNumber ||
        (query as any)?.policyDetails?.carRegistrationNo ||
        null;
      const rcLookup =
        (query as any)?.rcLookup ||
        (rcNumberCandidate &&
        normalizeRcNumber(String(rcNumberCandidate)).length >= 6
          ? await VehicleRcLookup.findOne({
              idNumber: normalizeRcNumber(String(rcNumberCandidate)),
            }).lean()
          : null);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            policyDetails: (query as any)?.policyDetails || {},
            customerId: customer,
            rcLookup,
            activities: await enrichActivityActors(
              Array.isArray(query.activities)
                ? query.activities.slice(-100)
                : [],
            ),
          },
          "Loan query detail extras fetched successfully",
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  static async addNote(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { note } = req.body;

      if (!note) {
        return res.status(400).json(new ApiError(400, "Note is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only add notes to queries created or assigned to you",
            ),
          );
      }

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.NOTE_ADDED,
        description: note,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Note added successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { status, remarks } = req.body;

      if (!status) {
        return res.status(400).json(new ApiError(400, "Status is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update status of queries created or assigned to you",
            ),
          );
      }

      const oldStatus = query.status;
      query.status = status;

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.STATUS_CHANGED,
        description: `Status changed from ${oldStatus} to ${status}${
          remarks ? `: ${remarks}` : ""
        }`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: {
          oldStatus,
          newStatus: status,
          remarks,
        },
        createdAt: new Date(),
      });

      await query.save();
      if (oldStatus !== status && status === ApplicationStatus.DISBURSED) {
        await agencyEarningsService.recordLoanDisbursalCommission(
          query,
          actorId?.toString(),
        );
      }

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Status updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateDocuments(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update documents of queries created or assigned to you",
            ),
          );
      }

      // Handle file uploads from multer/S3 middleware
      let documentsToAdd: Record<string, string> = {};

      // Files uploaded via multer middleware will be in req.body with URLs
      const documentTypes = [
        "pan_card",
        "aadhaar_card",
        "photo",
        "itr_form_16",
        "salary_slip",
        "offer_letter",
        "relieving_letter",
        "bank_statement",
        "gst_certificate",
        "gst_returns",
        "shop_act",
        "govt_license",
      ];

      documentTypes.forEach((docType) => {
        if (req.body[docType]) {
          const urlData = req.body[docType];
          // Extract URL from multer/S3 response format
          const url = Array.isArray(urlData)
            ? urlData[0]?.url
            : urlData?.url || urlData;
          if (url) {
            documentsToAdd[docType] = url;
          }
        }
      });

      // Also support direct URL input via documents object
      if (req.body.documents && typeof req.body.documents === "object") {
        documentsToAdd = { ...documentsToAdd, ...req.body.documents };
      }

      if (Object.keys(documentsToAdd).length === 0) {
        return res.status(400).json(new ApiError(400, "No documents provided"));
      }

      // Merge documents
      query.documents = { ...query.documents, ...documentsToAdd };

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.DOCUMENT_UPLOADED,
        description: `Documents uploaded: ${Object.keys(documentsToAdd).join(
          ", ",
        )}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: { uploadedDocuments: Object.keys(documentsToAdd) },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Documents updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePolicyDocuments(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update policy documents of queries created or assigned to you",
            ),
          );
      }

      const policyDocumentFields = [
        "salarySlipUrl",
        "admissionLetterUrl",
        "feeStructureUrl",
        "rcCopyUrl",
        "goldPhotosUrl",
        "carInsuranceUrl",
        "lastMonthBankStatementUrl",
        "propertyDocumentsUrl",
        "propertyOwnershipProofUrl",
        "renovationEstimateUrl",
        "itrUrl",
        "gstReturnsUrl",
        "dematStatementOrFdCopyUrl",
        "proformaInvoiceOrQuotationUrl",
        "businessRegistrationCertificateUrl",
      ];

      const incoming: Record<string, any> = {};
      policyDocumentFields.forEach((field) => {
        const raw = req.body?.[field] || req.body?.policyDetails?.[field];
        if (!raw) return;
        const urls = extractFileUrls(raw);
        if (urls.length === 0) return;
        incoming[field] = urls.length === 1 ? urls[0] : urls;
      });

      const bankStatementUrl = extractFileUrl(req.body?.bankStatementUrl);

      const allowed = allowedFieldsByFormType[query.loanType] || [];
      const invalidFields = Object.keys(incoming).filter(
        (field) => !allowed.includes(field),
      );
      if (invalidFields.length > 0) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              `Field(s) "${invalidFields.join(
                ", ",
              )}" is/are not allowed for ${query.loanType}`,
            ),
          );
      }

      if (!bankStatementUrl && Object.keys(incoming).length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No policy documents provided"));
      }

      if (Object.keys(incoming).length > 0) {
        query.policyDetails = { ...query.policyDetails, ...incoming };
      }
      if (bankStatementUrl) {
        query.bankStatementUrl = bankStatementUrl;
      }

      const uploadedFields = [
        ...Object.keys(incoming),
        ...(bankStatementUrl ? ["bankStatementUrl"] : []),
      ];

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.DOCUMENT_UPLOADED,
        description: `Policy documents uploaded: ${uploadedFields.join(", ")}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: { uploadedDocuments: uploadedFields },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(
          new ApiResponse(200, query, "Policy documents updated successfully"),
        );
    } catch (err) {
      next(err);
    }
  }

  static async updatePolicyDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const policyDetails = parseMaybeJson(req.body.policyDetails);

      if (!policyDetails || typeof policyDetails !== "object") {
        return res
          .status(400)
          .json(new ApiError(400, "Policy details object is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update policy details of queries created or assigned to you",
            ),
          );
      }

      // Merge policy details
      const normalizedPolicyDetails = {
        ...policyDetails,
        ...(policyDetails?.coApplicants
          ? {
              coApplicants: normalizeCoApplicants(policyDetails.coApplicants),
            }
          : {}),
      };

      query.policyDetails = {
        ...query.policyDetails,
        ...normalizedPolicyDetails,
      };

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.UPDATED,
        description: `Policy details updated`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: { updatedFields: Object.keys(policyDetails) },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(
          new ApiResponse(200, query, "Policy details updated successfully"),
        );
    } catch (err) {
      next(err);
    }
  }

  static async reassignLander(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const { landerId, reason } = req.body;

      // Only admin can reassign
      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can reassign landers"));
      }

      if (!landerId) {
        return res.status(400).json(new ApiError(400, "Lander ID is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      const lander = await Lander.findById(landerId).select("name email");
      if (!lander) {
        return res.status(404).json(new ApiError(404, "Lander not found"));
      }

      const actorId = (req as any).user?._id;
      const previousLanderId = query.assignedLander;

      query.assignedLander = new Types.ObjectId(landerId);

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.LANDER_ASSIGNED,
        description: `Lander reassigned to ${lander.name}${
          reason ? `: ${reason}` : ""
        }`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: "Admin",
        payload: {
          landerId,
          landerName: lander.name,
          previousLanderId: previousLanderId
            ? String(previousLanderId)
            : undefined,
          reason,
        },
        createdAt: new Date(),
      });

      await query.save();

      // Adjust lander loads
      if (
        previousLanderId &&
        previousLanderId.toString() !== landerId.toString()
      ) {
        await LanderAssignmentEngine.adjustLanderLoad(previousLanderId, -1);
      }
      await LanderAssignmentEngine.adjustLanderLoad(
        new Types.ObjectId(landerId),
        1,
      );

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Lander reassigned successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async completeQuery(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const actorId = (req as any).user?._id;
      const { remarks } = req.body;

      // Only admin or assigned lander can complete a query
      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(query, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only complete queries created or assigned to you",
            ),
          );
      }

      // Check if query is in a valid state to be completed
      if (query.status === "completed") {
        return res
          .status(400)
          .json(new ApiError(400, "Query is already completed"));
      }

      if (query.status === "cancelled") {
        return res
          .status(400)
          .json(new ApiError(400, "Cannot complete a cancelled query"));
      }

      console.log(`🏁 Completing loan query ${query._id}`);
      console.log(`  Current status: ${query.status}`);
      console.log(`  Completed by: ${role} (${actorId})`);
      console.log(`  Assigned Lander: ${query.assignedLander}`);

      const oldStatus = query.status;
      query.status = "completed" as any;

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.STATUS_CHANGED,
        description: `Query completed${remarks ? `: ${remarks}` : ""}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: {
          oldStatus,
          newStatus: "completed",
          remarks,
        },
        createdAt: new Date(),
      });

      await query.save();

      // Adjust agent load - reduce by 1 for every assigned agent now that the query is completed
      const assignedAgentIds = collectAssignedAgentIds(query);
      await Promise.all(
        assignedAgentIds.map((agentId) =>
          EmployeeAssignmentEngine.adjustEmployeeLoad(agentId, -1),
        ),
      );
      if (query.assignedLander) {
        console.log(`  📉 Adjusting lander load for ${query.assignedLander}`);
        await LanderAssignmentEngine.adjustLanderLoad(query.assignedLander, -1);
        console.log(`  ✅ Lander load decreased`);
      }

      console.log(`✅ Loan query ${query._id} marked as completed`);

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Loan query completed successfully"));
    } catch (err) {
      next(err);
    }
  }
}
