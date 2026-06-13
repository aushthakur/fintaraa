import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  LoanQuery,
  LoanType,
  LoanQueryActivityType,
  allowedFieldsByFormType,
} from "../../modals/loanquery.model";
import { ApplicationStatus } from "../../modals/insurancequery.model";
import LanderAssignmentEngine from "../../services/landerAssignment.service";
import mongoose, { Types } from "mongoose";
import Admin from "../../modals/admin.model";
import Lander from "../../modals/lander.model";
import { normalizeLoanType } from "../../utils/loanType";
import {
  fetchSurepassRcDetails,
  fetchSurepassCibilReport,
  fetchSurepassCibilPdfReport,
  prepareSurepassCibilPayload,
  prepareSurepassRcPayload,
} from "../../services/surepass.service";
import { VehicleRcLookup } from "../../modals/vehicleRcLookup.model";
import { CallRecord } from "../../modals/callRecord.model";
import { User } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import EmployeeAssignmentEngine from "../../services/employeeAssignment.service";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import {
  notifyLoanApplicationCreated,
  notifyLoanDocumentsUploaded,
  notifyLoanStageUpdated,
} from "../../services/loanCustomerNotification.service";
import {
  DEFAULT_QUERY_TIMEZONE,
  buildDateRangeInTimeZone,
  parseDateInTimeZone,
} from "../../utils/helper";

const RC_CACHE_TTL_DAYS = 365;
const normalizeRcNumber = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const getRcLookupFailureResponse = (err: any, rcNumber?: string) => {
  const providerData = err?.data || err?.response?.data || {};
  const providerMessage =
    providerData?.message ||
    providerData?.data?.message ||
    err?.message ||
    "Verification failed";
  const messageCode =
    providerData?.message_code || providerData?.data?.message_code || "";
  const upstreamStatus =
    Number(providerData?.status_code || providerData?.data?.status_code) ||
    Number(err?.statusCode || err?.status) ||
    422;
  const safeStatus = upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 422;
  const vehicleNumber =
    providerData?.data?.rc_number || providerData?.rc_number || rcNumber || "";

  const userMessage =
    messageCode === "verification_failed" ||
    String(providerMessage).toLowerCase().includes("verification failed")
      ? `No RC details found for ${vehicleNumber || "this vehicle number"}. Please check the registration number and try again.`
      : `Unable to fetch RC details${vehicleNumber ? ` for ${vehicleNumber}` : ""}. ${providerMessage}`;

  return {
    status: safeStatus,
    message: userMessage,
    data: {
      rcNumber: vehicleNumber,
      provider: "surepass",
      providerMessage,
      providerCode: messageCode || undefined,
      providerStatus: upstreamStatus,
    },
  };
};

const buildLoanRcLookupSnapshot = ({
  idNumber,
  report,
  payload,
  environment,
  fetchedAt,
  cached,
  lookupId,
}: {
  idNumber: string;
  report: Record<string, any>;
  payload?: Record<string, any>;
  environment?: string;
  fetchedAt: Date;
  cached: boolean;
  lookupId?: any;
}) => ({
  idNumber,
  report,
  payload: payload || {},
  environment,
  fetchedAt,
  cached,
  lookupId,
  updatedAt: new Date(),
});

const attachRcLookupToLoanQuery = async ({
  queryId,
  actorId,
  role,
  rcLookup,
}: {
  queryId?: any;
  actorId?: any;
  role?: string;
  rcLookup: Record<string, any>;
}) => {
  if (!queryId || !mongoose.Types.ObjectId.isValid(String(queryId))) return null;

  const query = await LoanQuery.findById(queryId)
    .select(
      "customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy policyDetails",
    )
    .lean()
    .exec();

  if (!query) throw new ApiError(404, "Loan query not found");
  if (!(await canAccessLoanQuery(query, actorId, role))) {
    throw new ApiError(403, "You can only update RC data for accessible queries");
  }

  const update: Record<string, any> = {
    rcLookup,
    "policyDetails.carRegistrationNumber": rcLookup.idNumber,
  };

  return LoanQuery.findByIdAndUpdate(
    queryId,
    { $set: update },
    { new: true, runValidators: false },
  )
    .select("rcLookup policyDetails.carRegistrationNumber")
    .lean()
    .exec();
};

const loanQueryService = new CommonService(LoanQuery);
const ACTIVE_QUERY_MATCH = { isDeleted: { $ne: true } };

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
    fileStatus: item.fileStatus || item.status,
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
  "leadBy",
  "dataSource",
  "createdBy",
  "updatedByName",
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

const resolveActorDisplayName = async (actorId: any, role?: string) => {
  const id = getIdString(actorId);
  if (!id) return "";

  const selectFields = "name username email mobile";
  const resolveFrom = async (model: any) => {
    const actor = await model.findById(id).select(selectFields).lean();
    if (!actor) return "";
    return actor.name || actor.username || actor.email || actor.mobile || "";
  };

  switch (role) {
    case "admin":
    case "agent":
      return resolveFrom(Admin);
    case "lander":
      return resolveFrom(Lander);
    case "agency":
    case "agency_member":
      return resolveFrom(Agency);
    default:
      return resolveFrom(User);
  }
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

const normalizeEmploymentTypeForLoanQuery = (value: any) => {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (key === "salaried" || key === "salary") return "salaried";
  if (
    ["selfemployedprofessional", "selfemployedpro", "selfprofessional"].includes(
      key,
    )
  ) {
    return "self_employed_professional";
  }
  if (
    [
      "selfemployednonprofessional",
      "selfemployednonpro",
      "selfnonprofessional",
      "selfemployed",
    ].includes(key)
  ) {
    return "self_employed_non_professional";
  }
  if (key === "selfemployedgeneric" || key === "selfemp") {
    return "self_employed";
  }
  return String(value || "").trim().toLowerCase();
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
        documents: Array.isArray(coApplicant.documents)
          ? coApplicant.documents
            .map((document: any) => {
              if (!document || typeof document !== "object") return null;
              const files = Array.isArray(document.files)
                ? document.files
                  .map((file: any) => normalizeUploadedAttachment(file))
                  .filter(Boolean)
                : [];
              const key = String(document.key || "").trim();
              const label = String(
                document.label || document.name || document.key || "",
              ).trim();
              if (!key && !label && files.length === 0) return null;
              return {
                ...document,
                key: key || label.toLowerCase().replace(/\s+/g, "_"),
                label: label || key,
                files,
              };
            })
            .filter(Boolean)
          : [],
      };
    })
    .filter(Boolean);
};

const normalizeReferenceContacts = (value: any) => {
  const parsed = parseMaybeJson(value);
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  return list
    .map((item) => {
      const reference = parseMaybeJson(item);
      if (!reference || typeof reference !== "object") return null;

      const name = String(reference.name || "").trim();
      const phone = String(reference.phone || "").trim();
      const address = String(reference.address || "").trim();
      const relation = String(reference.relation || "").trim();

      if (!name && !phone && !address && !relation) return null;

      return {
        name,
        phone,
        address,
        relation,
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
  if (req.body.policyDetails?.references) {
    req.body.policyDetails.references = normalizeReferenceContacts(
      req.body.policyDetails.references,
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
    let idNumber = "";
    try {
      const userId = (req as any).user?._id;
      const role = (req as any).user?.role;
      const queryId = req.body?.queryId || req.body?.loanQueryId;
      const payload = prepareSurepassRcPayload(req.body || {});
      idNumber = normalizeRcNumber(payload.id_number);
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
          const rcLookup = buildLoanRcLookupSnapshot({
            idNumber,
            report: cached.report,
            payload: cached.payload,
            environment: cached.environment,
            fetchedAt: new Date(cached.fetchedAt),
            cached: true,
            lookupId: cached._id,
          });
          await attachRcLookupToLoanQuery({
            queryId,
            actorId: userId,
            role,
            rcLookup,
          });
          return res.status(200).json(
            new ApiResponse(
              200,
              {
                environment: cached.environment,
                data: cached.report,
                cached: true,
                lastFetchedAt: cached.fetchedAt,
                rcLookup,
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
      const lookup = await VehicleRcLookup.findOneAndUpdate({ idNumber }, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }).lean();
      const rcLookup = buildLoanRcLookupSnapshot({
        idNumber,
        report: result.data,
        payload,
        environment: result.environment,
        fetchedAt: now,
        cached: false,
        lookupId: lookup?._id,
      });
      await attachRcLookupToLoanQuery({
        queryId,
        actorId: userId,
        role,
        rcLookup,
      });
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { ...result, cached: false, lastFetchedAt: now, rcLookup },
            "RC details fetched successfully",
          ),
        );
    } catch (err: any) {
      const failure = getRcLookupFailureResponse(err, idNumber);
      return res
        .status(failure.status)
        .json(new ApiError(failure.status, failure.message, failure.data));
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

      if (!(await canAccessLoanQuery(query, _id, role))) {
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

      if (!(await canAccessLoanQuery(query, _id, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only fetch CIBIL for queries created or assigned to you",
            ),
          );
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
      const customerId = (req as any).user?._id;
      const role = (req as any).user?.role;
      const session = (req as any).mongoSession;
      const adminActorId =
        role === "admin" || role === "agent"
          ? toObjectId((req as any).user?._id)
          : null;

      if (!customerId) {
        return res
          .status(401)
          .json(new ApiError(401, "User authentication required"));
      }

      const normalizedLoanType = normalizeLoanType(req.body.loanType);
      if (normalizedLoanType) req.body.loanType = normalizedLoanType;

      processFileUploads(req);

      req.body.customerId = customerId;

      const [agency, updatedByName] = await Promise.all([
        role === "agency_member"
          ? Agency.findById(customerId).select("parentAgency").lean().exec()
          : Promise.resolve(null),

        resolveActorDisplayName(customerId, role),
      ]);

      if (role === "agency" || role === "agency_member") {
        req.body.channelAgency = customerId;
        req.body.ownerAgency =
          role === "agency_member"
            ? (agency as any)?.parentAgency || customerId
            : customerId;
      }

      if (req.body.accountType) {
        req.body.accountType = normalizeAccountType(req.body.accountType);
      }

      if (updatedByName) {
        req.body.updatedByName = updatedByName;
      }

      if (req.body.policyDetails?.coApplicants) {
        const list = Array.isArray(req.body.policyDetails.coApplicants)
          ? req.body.policyDetails.coApplicants
          : [req.body.policyDetails.coApplicants];

        req.body.policyDetails.coApplicants = list.filter(Boolean);
      }

      if (req.body.policyDetails?.references) {
        req.body.policyDetails.references = normalizeReferenceContacts(
          req.body.policyDetails.references,
        );
      }

      const isDraft = req.body.status === ApplicationStatus.DRAFT;

      if (
        !isDraft &&
        req.body.loanType &&
        req.body.policyDetails &&
        Object.keys(req.body.policyDetails).length > 0
      ) {
        const allowed = allowedFieldsByFormType[req.body.loanType] || [];

        if (allowed.length > 0) {
          const invalidFields = Object.keys(req.body.policyDetails).filter(
            (field) => !allowed.includes(field),
          );

          if (invalidFields.length > 0) {
            return res
              .status(400)
              .json(
                new ApiError(
                  400,
                  `Field(s) "${invalidFields.join(", ")}" is/are not allowed for ${
                    req.body.loanType
                  }. Allowed fields: ${allowed.join(", ")}`,
                ),
              );
          }
        }
      }

      if (req.body.loanType) {
        const existingQuery = await LoanQuery.exists({
          customerId,
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

      const activity = {
        type: LoanQueryActivityType.CREATED,
        description: isDraft
          ? "Loan query created as draft"
          : "Loan query created",
        actor: customerId ? new Types.ObjectId(String(customerId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "User",
        createdAt: new Date(),
      };

      let result: any;

      if (isDraft) {
        const draftData = {
          ...req.body,
          ...(adminActorId
            ? { createdBy: adminActorId, updatedBy: adminActorId }
            : {}),
          status: ApplicationStatus.DRAFT,
          activities: [activity],
        };

        result = new LoanQuery(draftData);
        await result.save({ validateBeforeSave: false, session });
      } else {
        const createData = {
          ...req.body,
          ...(adminActorId
            ? { createdBy: adminActorId, updatedBy: adminActorId }
            : {}),
          activities: [activity],
        };

        result = await LoanQuery.create([createData], { session });
        result = result?.[0];

        if (result && !result.assignedAgent) {
          result = await EmployeeAssignmentEngine.ensureAssignmentForLoanQuery(
            result,
            {
              actorId: customerId?.toString(),
              actorModel: role === "admin" ? "Admin" : "User",
              reason: "new_loan_query",
              session,
            },
          );
        }

        if (result && !result.assignedLander) {
          result = await LanderAssignmentEngine.ensureAssignment(result, {
            actorId: customerId?.toString(),
            reason: "new_loan_query",
            session,
          });
        }

        if (result?.isModified?.()) {
          await result.save({ session });
        }
      }

      if (!result) {
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create loan query"));
      }

      if (!isDraft) {
        await notifyLoanApplicationCreated(result);
      }

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
      } else if (
        requiresStatus &&
        !req.query.status &&
        !req.query.status__ne &&
        !req.query.status__nin
      ) {
        req.query.status = ApplicationStatus.SUBMITTED;
      }

      if (req.query.loanType) {
        const normalized = normalizeLoanType(String(req.query.loanType));
        if (normalized) req.query.loanType = normalized;
      }

      const prependStages: any[] = [];
      prependStages.push({ $match: ACTIVE_QUERY_MATCH });

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
          $lookup: {
            from: "admins",
            localField: "createdBy",
            foreignField: "_id",
            as: "createdByData",
          },
        },
        {
          $unwind: {
            path: "$createdByData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "roles",
            localField: "createdByData.role",
            foreignField: "_id",
            as: "createdByRoleData",
          },
        },
        {
          $unwind: {
            path: "$createdByRoleData",
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
            createdBy: {
              $cond: {
                if: { $ifNull: ["$createdByData", false] },
                then: {
                  _id: "$createdByData._id",
                  name: "$createdByData.name",
                  username: "$createdByData.username",
                  email: "$createdByData.email",
                  mobile: "$createdByData.mobile",
                  role: {
                    _id: "$createdByRoleData._id",
                    name: "$createdByRoleData.name",
                  },
                },
                else: "$createdBy",
              },
            },
          },
        },
        {
          $project: {
            assignedAgentData: 0,
            assignedAgentsData: 0,
            assignedLanderData: 0,
            createdByData: 0,
            createdByRoleData: 0,
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

  static async getCompletedPremiumStats(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const { startDate, endDate, rangePreset, loanType } = req.query as Record<
        string,
        string
      >;

      const toDate = (v?: string): Date | null => {
        if (!v) return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return null;
        return d;
      };

      // Resolve disbursed date range (CURRENT)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let currentStart: Date | null = toDate(startDate);
      let currentEnd: Date | null = toDate(endDate);

      const applyPreset = () => {
        if (rangePreset === "last_7_days") {
          const end = new Date(today);
          const start = new Date(today);
          start.setDate(start.getDate() - 6);
          currentStart = start;
          currentEnd = end;
          return;
        }
        if (rangePreset === "last_30_days") {
          const end = new Date(today);
          const start = new Date(today);
          start.setDate(start.getDate() - 29);
          currentStart = start;
          currentEnd = end;
          return;
        }
        if (rangePreset === "this_month") {
          const end = new Date(today);
          const start = new Date(today.getFullYear(), today.getMonth(), 1);
          currentStart = start;
          currentEnd = end;
          return;
        }
        if (rangePreset === "last_month") {
          const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          const end = new Date(today.getFullYear(), today.getMonth(), 0);
          currentStart = start;
          currentEnd = end;
          return;
        }
      };

      if (!currentStart || !currentEnd) {
        applyPreset();
      }

      if (!currentStart || !currentEnd) {
        // default: last 30 days
        const end = new Date(today);
        const start = new Date(today);
        start.setDate(start.getDate() - 29);
        currentStart = start;
        currentEnd = end;
      }

      const currentEndFixed = new Date(currentEnd);
      currentEndFixed.setHours(23, 59, 59, 999);

      const daysInRange = Math.max(
        1,
        Math.ceil(
          (currentEndFixed.getTime() - currentStart.getTime()) /
            (1000 * 60 * 60 * 24) +
            1,
        ),
      );

      // Resolve PREVIOUS equal-length range
      const previousEnd = new Date(currentStart);
      previousEnd.setDate(previousEnd.getDate() - 1);
      previousEnd.setHours(23, 59, 59, 999);

      const previousStart = new Date(previousEnd);
      previousStart.setDate(previousStart.getDate() - (daysInRange - 1));
      previousStart.setHours(0, 0, 0, 0);

      const normalizedLoanType = loanType
        ? normalizeLoanType(String(loanType))
        : "";

      const scopeForRole = (extra: Record<string, any>) => {
        Object.assign(extra, buildLoanScopeMatch(userId, role));
        return extra;
      };

      const completedMatch: Record<string, any> = {
        ...ACTIVE_QUERY_MATCH,
        status: ApplicationStatus.COMPLETED,
      };

      const currentMatch: Record<string, any> = {
        ...ACTIVE_QUERY_MATCH,
        status: ApplicationStatus.COMPLETED,
        disbursedDate: {
          $gte: currentStart,
          $lte: currentEndFixed,
        },
      };

      const previousMatch: Record<string, any> = {
        ...ACTIVE_QUERY_MATCH,
        status: ApplicationStatus.COMPLETED,
        disbursedDate: {
          $gte: previousStart,
          $lte: previousEnd,
        },
      };

      if (normalizedLoanType) {
        completedMatch.loanType = normalizedLoanType;
        currentMatch.loanType = normalizedLoanType;
        previousMatch.loanType = normalizedLoanType;
      }

      scopeForRole(completedMatch);
      scopeForRole(currentMatch);
      scopeForRole(previousMatch);

      const [completedAgg, currentAgg, previousAgg] = await Promise.all([
        LoanQuery.aggregate([
          { $match: completedMatch },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              totalLoanAmount: { $sum: { $ifNull: ["$loanAmount", 0] } },
              assignedCount: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        { $ne: ["$assignedLander", null] },
                        { $ne: ["$assignedLander", undefined] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        LoanQuery.aggregate([
          { $match: currentMatch },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              totalLoanAmount: { $sum: { $ifNull: ["$loanAmount", 0] } },
              totalDisbursedAmount: {
                $sum: { $ifNull: ["$disbursedAmount", 0] },
              },
              assignedCount: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        { $ne: ["$assignedLander", null] },
                        { $ne: ["$assignedLander", undefined] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        LoanQuery.aggregate([
          { $match: previousMatch },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              totalLoanAmount: { $sum: { $ifNull: ["$loanAmount", 0] } },
              totalDisbursedAmount: {
                $sum: { $ifNull: ["$disbursedAmount", 0] },
              },
              assignedCount: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        { $ne: ["$assignedLander", null] },
                        { $ne: ["$assignedLander", undefined] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
      ]);

      const completed = completedAgg?.[0] || {
        total: 0,
        totalLoanAmount: 0,
        assignedCount: 0,
      };

      const cur = currentAgg?.[0] || {
        total: 0,
        totalLoanAmount: 0,
        totalDisbursedAmount: 0,
        assignedCount: 0,
      };

      const prev = previousAgg?.[0] || {
        total: 0,
        totalLoanAmount: 0,
        totalDisbursedAmount: 0,
        assignedCount: 0,
      };

      const safePct = (current: number, previous: number) => {
        const c = Number(current) || 0;
        const p = Number(previous) || 0;
        if (p === 0) {
          if (c === 0) return 0;
          return 100;
        }
        return ((c - p) / p) * 100;
      };

      const disbursedGrowthPercent = safePct(
        cur.totalDisbursedAmount,
        prev.totalDisbursedAmount,
      );

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            loanType: normalizedLoanType || "all",
            disbursedRange: {
              startDate: currentStart.toISOString(),
              endDate: currentEndFixed.toISOString(),
            },
            previousDisbursedRange: {
              startDate: previousStart.toISOString(),
              endDate: previousEnd.toISOString(),
            },
            totalCompleted: completed.total,
            totalLoanAmount: completed.totalLoanAmount,
            totalDisbursedAmount: cur.totalDisbursedAmount,
            assignedInView: completed.assignedCount,
            disbursedGrowthPercent,
          },
          "Completed loan premium stats fetched successfully",
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

      const hasDateRange = Boolean(startDate && endDate);
      const start = hasDateRange ? new Date(startDate) : null;
      const end = hasDateRange ? new Date(endDate) : null;

      if (
        hasDateRange &&
        (!start ||
          !end ||
          Number.isNaN(start.getTime()) ||
          Number.isNaN(end.getTime()))
      ) {
        return res.status(400).json(new ApiError(400, "Invalid date range"));
      }

      start?.setHours(0, 0, 0, 0); // 12:00 AM
      end?.setHours(23, 59, 59, 0); // 23:59 PM (end of the day)

      const match: Record<string, any> = {
        ...ACTIVE_QUERY_MATCH,
      };

      if (start && end) {
        match.createdAt = { $gte: start, $lte: end };
      }

      if (normalizedLoanType) {
        match.loanType = normalizedLoanType;
      }

      Object.assign(match, buildLoanScopeMatch(userId, role));

      const disbursedMatch: Record<string, any> = {
        ...ACTIVE_QUERY_MATCH,
        disbursedAmount: { $gt: 0 },
      };

      if (start && end) {
        disbursedMatch.disbursedDate = { $gte: start, $lte: end };
      }

      if (normalizedLoanType) {
        disbursedMatch.loanType = normalizedLoanType;
      }

      Object.assign(disbursedMatch, buildLoanScopeMatch(userId, role));

      const buildStats = async (
        baseMatch: Record<string, any>,
        baseDisbursedMatch: Record<string, any>,
      ) => {
        const [rows, disbursedAgg] = await Promise.all([
          LoanQuery.aggregate([
            { $match: baseMatch },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                amount: { $sum: { $ifNull: ["$loanAmount", 0] } },
                disbursedAmount: {
                  $sum: { $ifNull: ["$disbursedAmount", 0] },
                },
              },
            },
          ]),
          LoanQuery.aggregate([
            { $match: baseDisbursedMatch },
            {
              $group: {
                _id: null,
                totalDisbursedCount: { $sum: 1 },
                totalDisbursedAmount: {
                  $sum: { $ifNull: ["$disbursedAmount", 0] },
                },
              },
            },
          ]),
        ]);

        const byStatus: Record<string, number> = {};
        const amountByStatus: Record<string, number> = {};
        const disbursedAmountByStatus: Record<string, number> = {};
        let total = 0;
        let totalAmount = 0;
        let createdAtDisbursedAmount = 0;

        rows.forEach((row: any) => {
          const key = row?._id ? String(row._id) : "unknown";
          const count = Number(row?.count) || 0;
          const amount = Number(row?.amount) || 0;
          const disbursedAmount = Number(row?.disbursedAmount) || 0;
          byStatus[key] = count;
          amountByStatus[key] = amount;
          disbursedAmountByStatus[key] = disbursedAmount;
          total += count;
          totalAmount += amount;
          createdAtDisbursedAmount += disbursedAmount;
        });
        byStatus.not_completed = Math.max(
          0,
          total - (byStatus[ApplicationStatus.COMPLETED] || 0),
        );

        const totalDisbursedAmount =
          Number(disbursedAgg?.[0]?.totalDisbursedAmount) || 0;
        const totalDisbursedCount =
          Number(disbursedAgg?.[0]?.totalDisbursedCount) || 0;

        return {
          total,
          totalAmount,
          totalDisbursedAmount,
          totalDisbursedCount,
          createdAtDisbursedAmount,
          byStatus,
          amountByStatus,
          disbursedAmountByStatus,
        };
      };

      const calculateChangePercent = (current: number, previous: number) => {
        if (!previous) return current ? 100 : 0;
        return ((current - previous) / previous) * 100;
      };

      const currentStats = await buildStats(match, disbursedMatch);

      let previousStats: Awaited<ReturnType<typeof buildStats>> | null = null;
      let previousRange: { startDate: string; endDate: string } | null = null;

      if (start && end) {
        const previousEnd = new Date(start.getTime() - 1);
        const previousStart = new Date(
          previousEnd.getTime() - (end.getTime() - start.getTime()),
        );
        previousRange = {
          startDate: previousStart.toISOString(),
          endDate: previousEnd.toISOString(),
        };

        const previousMatch = {
          ...match,
          createdAt: { $gte: previousStart, $lte: previousEnd },
        };
        const previousDisbursedMatch = {
          ...disbursedMatch,
          disbursedDate: { $gte: previousStart, $lte: previousEnd },
        };
        previousStats = await buildStats(previousMatch, previousDisbursedMatch);
      }

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            loanType: normalizedLoanType || "all",
            range:
              start && end
                ? {
                    startDate: start.toISOString(),
                    endDate: end.toISOString(),
                  }
                : null,
            previousRange,
            total: currentStats.total,
            totalAmount: currentStats.totalAmount,
            totalDisbursedAmount: currentStats.totalDisbursedAmount,
            disbursedAmount: currentStats.totalDisbursedAmount,
            totalDisbursed: currentStats.totalDisbursedAmount,
            totalDisbursedCount: currentStats.totalDisbursedCount,
            createdAtDisbursedAmount: currentStats.createdAtDisbursedAmount,
            byStatus: currentStats.byStatus,
            amountByStatus: currentStats.amountByStatus,
            disbursedAmountByStatus: currentStats.disbursedAmountByStatus,
            previous: previousStats
              ? {
                  total: previousStats.total,
                  totalAmount: previousStats.totalAmount,
                  totalDisbursedAmount: previousStats.totalDisbursedAmount,
                  disbursedAmount: previousStats.totalDisbursedAmount,
                  totalDisbursed: previousStats.totalDisbursedAmount,
                  totalDisbursedCount: previousStats.totalDisbursedCount,
                }
              : null,
            changePercent: previousStats
              ? {
                  total: calculateChangePercent(
                    currentStats.total,
                    previousStats.total,
                  ),
                  totalAmount: calculateChangePercent(
                    currentStats.totalAmount,
                    previousStats.totalAmount,
                  ),
                  totalDisbursedAmount: calculateChangePercent(
                    currentStats.totalDisbursedAmount,
                    previousStats.totalDisbursedAmount,
                  ),
                }
              : null,
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
      Object.assign(match, ACTIVE_QUERY_MATCH);
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
      const queryId = req.params.id;
      const session = (req as any).mongoSession;

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      if (req.body.loanType) {
        const normalized = normalizeLoanType(req.body.loanType);
        if (normalized) req.body.loanType = normalized;
      }

      if (req.body.employmentType) {
        req.body.employmentType = normalizeEmploymentTypeForLoanQuery(
          req.body.employmentType,
        );
      }

      const existingResult = await LoanQuery.findById(queryId)
        .select(
          "status customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy policyDetails documents",
        )
        .lean()
        .exec();

      if (!existingResult) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      const adminCanEditAnyStatus = role === "admin";

      if (
        !adminCanEditAnyStatus &&
        existingResult.status !== ApplicationStatus.DRAFT
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Only draft queries can be updated"));
      }

      if (!(await canAccessLoanQuery(existingResult, customerId, role))) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update your own loan queries"));
      }

      processFileUploads(req);

      delete req.body.customerId;

      if (req.body.accountType) {
        req.body.accountType = normalizeAccountType(req.body.accountType);
      }

      const updatedByName = await resolveActorDisplayName(customerId, role);

      if (updatedByName) {
        req.body.updatedByName = updatedByName;
      }

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

      if (req.body.policyDetails?.references) {
        req.body.policyDetails.references = normalizeReferenceContacts(
          req.body.policyDetails.references,
        );
      }

      if (req.body.documents && existingResult.documents) {
        req.body.documents = {
          ...existingResult.documents,
          ...req.body.documents,
        };
      }

      const nextStatus = req.body.status || existingResult.status;

      const activity =
        existingResult.status !== nextStatus
          ? {
              type: LoanQueryActivityType.STATUS_CHANGED,
              description: `Status changed from ${existingResult.status} to ${nextStatus}`,
              actor: customerId
                ? new Types.ObjectId(String(customerId))
                : undefined,
              actorModel: role === "admin" ? "Admin" : "User",
              payload: {
                previousStatus: existingResult.status,
                newStatus: nextStatus,
              },
              createdAt: new Date(),
            }
          : {
              type: LoanQueryActivityType.UPDATED,
              description: "Loan query updated",
              actor: customerId
                ? new Types.ObjectId(String(customerId))
                : undefined,
              actorModel: role === "admin" ? "Admin" : "User",
              createdAt: new Date(),
            };

      let updatedResult: any = await LoanQuery.findOneAndUpdate(
        adminCanEditAnyStatus
          ? {
              _id: queryId,
            }
          : {
              _id: queryId,
              status: ApplicationStatus.DRAFT,
            },
        {
          $set: req.body,
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators:
            adminCanEditAnyStatus || nextStatus !== ApplicationStatus.DRAFT,
          session,
        },
      ).exec();

      if (!updatedResult) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              adminCanEditAnyStatus
                ? "Loan query could not be updated"
                : "Only draft queries can be updated",
            ),
          );
      }

      const isDraftSubmitted =
        existingResult.status === ApplicationStatus.DRAFT &&
        updatedResult.status !== ApplicationStatus.DRAFT;

      if (isDraftSubmitted && !updatedResult.assignedAgent) {
        updatedResult =
          await EmployeeAssignmentEngine.ensureAssignmentForLoanQuery(
            updatedResult,
            {
              actorId: customerId?.toString(),
              actorModel: role === "admin" ? "Admin" : "User",
              reason: "draft_submitted",
              session,
            },
          );
      }

      if (isDraftSubmitted && !updatedResult.assignedLander) {
        updatedResult = await LanderAssignmentEngine.ensureAssignment(
          updatedResult,
          {
            actorId: customerId?.toString(),
            reason: "draft_submitted",
            session,
          },
        );
      }

      if (updatedResult?.isModified?.()) {
        await updatedResult.save({ session });
      }

      if (
        existingResult.status !== updatedResult.status &&
        updatedResult.status === ApplicationStatus.DISBURSED
      ) {
        await agencyEarningsService.recordLoanDisbursalCommission(
          updatedResult,
          customerId?.toString(),
        );
      }

      if (existingResult.status !== updatedResult.status) {
        await notifyLoanStageUpdated(updatedResult);
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
      const { role } = (req as any).user || {};
      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can delete loan queries"));
      }
      const result = await LoanQuery.findOneAndUpdate(
        { _id: req.params.id, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: (req as any).user?._id || null,
          },
        },
        { new: true },
      ).exec();
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
      const updatedByName = await resolveActorDisplayName(actorId, role);

      // Update assignedLander and add activity
      const updatedResult = await loanQueryService.updateById(
        req.params.id,
        {
          assignedLander: landerId,
          updatedByName: updatedByName || undefined,
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
      const { role, _id: actorId } = (req as any).user || {};
      const queryId = req.params.id;

      const incomingAgentIds: string[] = Array.isArray(req.body?.agentIds)
        ? req.body.agentIds
        : req.body?.agentId
          ? [req.body.agentId]
          : [];

      const selectedAgentIds = Array.from(
        new Set(
          incomingAgentIds
            .map((value: any) => String(value || "").trim())
            .filter(Boolean),
        ),
      );

      if (!["admin", "agent"].includes(role)) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "Only admin or assigned agents can assign agents",
            ),
          );
      }

      if (!selectedAgentIds.length) {
        return res
          .status(400)
          .json(new ApiError(400, "At least one agent ID is required"));
      }

      if (selectedAgentIds.length > 10) {
        return res
          .status(400)
          .json(new ApiError(400, "You can assign up to 10 agents only"));
      }

      if (
        !Types.ObjectId.isValid(queryId) ||
        selectedAgentIds.some((id) => !Types.ObjectId.isValid(id))
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid query or agent id"));
      }

      const existingResult = await LoanQuery.findById(queryId)
        .select(
          "customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

      if (!existingResult) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!(await canAccessLoanQuery(existingResult, actorId, role))) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only assign agents to queries created or assigned to you",
            ),
          );
      }

      const [agents, updatedByName] = await Promise.all([
        Admin.find({ _id: { $in: selectedAgentIds } })
          .populate("role", "name")
          .select("_id name username email mobile role")
          .lean()
          .exec(),

        resolveActorDisplayName(actorId, role),
      ]);

      if (agents.length !== selectedAgentIds.length) {
        return res
          .status(404)
          .json(new ApiError(404, "One or more agents were not found"));
      }

      const invalidAgent = agents.find(
        (agent: any) => agent?.role?.name !== "agent",
      );

      if (invalidAgent) {
        return res
          .status(400)
          .json(new ApiError(400, "Selected employee is not an agent"));
      }

      const previousAgentIds = collectAssignedAgentIds(existingResult);
      const nextAgentIds = selectedAgentIds;

      const addedAgentIds = nextAgentIds.filter(
        (id) => !previousAgentIds.includes(id),
      );

      const removedAgentIds = previousAgentIds.filter(
        (id) => !nextAgentIds.includes(id),
      );

      const primaryAgentId = nextAgentIds[0];

      const agentNames = agents
        .map((agent: any) => agent?.name || agent?.username || agent?.email)
        .filter(Boolean);

      const activity = {
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
      };

      const updatedResult = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: {
            assignedAgent: new Types.ObjectId(primaryAgentId),
            assignedAgents: nextAgentIds.map((id) => new Types.ObjectId(id)),
            ...(updatedByName ? { updatedByName } : {}),
          },
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "status updatedByName assignedAgent assignedAgents assignedLander customerId ownerAgency channelAgency",
        )
        .populate("assignedAgent", "name username email mobile")
        .populate("assignedAgents", "name username email mobile")
        .lean()
        .exec();

      const loadUpdates = [
        ...removedAgentIds.map((agentId) =>
          EmployeeAssignmentEngine.adjustEmployeeLoad(agentId, -1),
        ),
        ...addedAgentIds.map((agentId) =>
          EmployeeAssignmentEngine.adjustEmployeeLoad(agentId, 1),
        ),
      ];

      await Promise.allSettled(loadUpdates);

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
      const authUser = (req as any).user || {};
      const userId = authUser?._id;
      const role = authUser?.role;

      const queryId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      const query = await LoanQuery.findById(queryId)
        .select({
          activities: { $slice: -40 }, // HUGE optimization
          rcLookup: 1,
          customerId: 1,
          assignedAgent: 1,
          assignedAgents: 1,
          assignedLander: 1,
          ownerAgency: 1,
          channelAgency: 1,
          "policyDetails.coApplicants": 1,
          "policyDetails.references": 1,
          "policyDetails.carRegistrationNumber": 1,
          "policyDetails.carRegistrationNo": 1,
        })
        .lean()
        .exec();

      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // avoid expensive permission calls if possible
      const hasDirectAccess =
        role === "SUPER_ADMIN" ||
        String(query?.assignedAgent || "") === String(userId) ||
        String(query?.customerId || "") === String(userId) ||
        (Array.isArray(query?.assignedAgents) &&
          query.assignedAgents.some(
            (id: any) => String(id) === String(userId),
          ));

      if (!hasDirectAccess) {
        const allowed = await canAccessLoanQuery(query, userId, role);

        if (!allowed) {
          return res
            .status(403)
            .json(
              new ApiError(
                403,
                "You can only view details of queries created or assigned to you",
              ),
            );
        }
      }

      const customerId = getIdString(
        (query as any)?.customerId?._id || query?.customerId,
      );

      const rcNumberCandidate =
        (query as any)?.rcLookup?.idNumber ||
        (query as any)?.policyDetails?.carRegistrationNumber ||
        (query as any)?.policyDetails?.carRegistrationNo;

      const activities = Array.isArray(query.activities)
        ? query.activities
        : [];

      const customerPromise = customerId
        ? User.findById(customerId)
            .select({
              cibilScore: 1,
              cibilLastFetchedAt: 1,
              cibilReport: 1,
              cibilRequestPayload: 1,
              cibilPdfLastFetchedAt: 1,
              cibilPdfReport: 1,
              digiLockerVault: 1,
            })
            .lean()
            .exec()
        : Promise.resolve(null);

      const rcLookupPromise = (query as any)?.rcLookup
        ? Promise.resolve((query as any)?.rcLookup)
        : rcNumberCandidate &&
            normalizeRcNumber(String(rcNumberCandidate)).length >= 6
          ? VehicleRcLookup.findOne({
              idNumber: normalizeRcNumber(String(rcNumberCandidate)),
            })
              .lean()
              .exec()
          : Promise.resolve(null);

      const activitiesPromise = activities.length
        ? enrichActivityActors(activities)
        : Promise.resolve([]);

      const [customer, rcLookup, enrichedActivities] = await Promise.all([
        customerPromise,
        rcLookupPromise,
        activitiesPromise,
      ]);

      const linkedCallRecords = await CallRecord.find({
        loanQueryId: new Types.ObjectId(queryId),
      })
        .sort({ updatedAt: -1 })
        .populate("channelAgency", "name mobile role status")
        .populate("attachedLead", "fullName mobile status productType loanType")
        .populate("assignee", "name email")
        .populate({
          path: "createdBy",
          select: "name username email role",
          populate: { path: "role", select: "name" },
        })
        .lean()
        .exec();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            policyDetails: (query as any)?.policyDetails || {},
            customerId: customer,
            rcLookup,
            activities: enrichedActivities,
            linkedCallRecords,
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
      const queryId = req.params.id;

      if (!note) {
        return res.status(400).json(new ApiError(400, "Note is required"));
      }

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      const query = await LoanQuery.findById(queryId)
        .select(
          "customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

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

      const updatedByName = await resolveActorDisplayName(actorId, role);

      const activity = {
        type: LoanQueryActivityType.NOTE_ADDED,
        description: note,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        createdAt: new Date(),
      };

      const updatedQuery = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: {
            ...(updatedByName ? { updatedByName } : {}),
          },
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "status updatedByName customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency",
        )
        .lean()
        .exec();

      return res
        .status(200)
        .json(new ApiResponse(200, updatedQuery, "Note added successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { status, remarks } = req.body;
      const queryId = req.params.id;

      if (!status) {
        return res.status(400).json(new ApiError(400, "Status is required"));
      }

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      const query = await LoanQuery.findById(queryId)
        .select(
          "status customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

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

      if (oldStatus === status) {
        return res
          .status(200)
          .json(new ApiResponse(200, query, "Status already updated"));
      }

      const [updatedByName] = await Promise.all([
        resolveActorDisplayName(actorId, role),
      ]);

      const activity = {
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
      };

      const updatedQuery = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: {
            status,
            ...(updatedByName ? { updatedByName } : {}),
          },
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "status updatedByName activities customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency",
        )
        .lean()
        .exec();

      if (
        oldStatus !== status &&
        status === ApplicationStatus.DISBURSED &&
        updatedQuery
      ) {
        await agencyEarningsService.recordLoanDisbursalCommission(
          updatedQuery,
          actorId?.toString(),
        );
      }

      if (oldStatus !== status && updatedQuery) {
        await notifyLoanStageUpdated(updatedQuery);
      }

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedQuery, "Status updated successfully"),
        );
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
      const queryId = req.params.id;

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      const query = await LoanQuery.findById(queryId)
        .select(
          "customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

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

      let documentsToAdd: Record<string, string> = {};

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
        if (!req.body[docType]) return;

        const urlData = req.body[docType];

        const url = Array.isArray(urlData)
          ? urlData[0]?.url
          : urlData?.url || urlData;

        if (url) {
          documentsToAdd[docType] = url;
        }
      });

      if (req.body.documents && typeof req.body.documents === "object") {
        documentsToAdd = {
          ...documentsToAdd,
          ...req.body.documents,
        };
      }

      const uploadedDocumentKeys = Object.keys(documentsToAdd);

      if (!uploadedDocumentKeys.length) {
        return res.status(400).json(new ApiError(400, "No documents provided"));
      }

      const updatedByName = await resolveActorDisplayName(actorId, role);

      const updateSet: Record<string, any> = {
        ...(updatedByName ? { updatedByName } : {}),
      };

      uploadedDocumentKeys.forEach((key) => {
        updateSet[`documents.${key}`] = documentsToAdd[key];
      });

      const activity = {
        type: LoanQueryActivityType.DOCUMENT_UPLOADED,
        description: `Documents uploaded: ${uploadedDocumentKeys.join(", ")}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: {
          uploadedDocuments: uploadedDocumentKeys,
        },
        createdAt: new Date(),
      };

      const updatedQuery = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: updateSet,
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "documents updatedByName customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency loanId loanType firstName lastName",
        )
        .lean()
        .exec();

      if (updatedQuery) {
        await notifyLoanDocumentsUploaded(updatedQuery, uploadedDocumentKeys);
      }

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedQuery, "Documents updated successfully"),
        );
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
      const queryId = req.params.id;

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      const query = await LoanQuery.findById(queryId)
        .select(
          "loanType customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

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
        if (!urls.length) return;

        incoming[field] = urls.length === 1 ? urls[0] : urls;
      });

      const bankStatementUrl = extractFileUrl(req.body?.bankStatementUrl);

      const allowed = allowedFieldsByFormType[(query as any).loanType] || [];

      if (allowed.length > 0) {
        const invalidFields = Object.keys(incoming).filter(
          (field) => !allowed.includes(field),
        );

        if (invalidFields.length > 0) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                `Field(s) "${invalidFields.join(", ")}" is/are not allowed for ${
                  (query as any).loanType
                }`,
              ),
            );
        }
      }

      if (!bankStatementUrl && Object.keys(incoming).length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No policy documents provided"));
      }

      const uploadedFields = [
        ...Object.keys(incoming),
        ...(bankStatementUrl ? ["bankStatementUrl"] : []),
      ];

      const updatedByName = await resolveActorDisplayName(actorId, role);

      const updateSet: Record<string, any> = {
        ...(updatedByName ? { updatedByName } : {}),
        ...(bankStatementUrl ? { bankStatementUrl } : {}),
      };

      Object.entries(incoming).forEach(([key, value]) => {
        updateSet[`policyDetails.${key}`] = value;
      });

      const activity = {
        type: LoanQueryActivityType.DOCUMENT_UPLOADED,
        description: `Policy documents uploaded: ${uploadedFields.join(", ")}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: { uploadedDocuments: uploadedFields },
        createdAt: new Date(),
      };

      const updatedQuery = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: updateSet,
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "loanType policyDetails bankStatementUrl updatedByName customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency",
        )
        .lean()
        .exec();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedQuery,
            "Policy documents updated successfully",
          ),
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
      const queryId = req.params.id;
      const policyDetails = parseMaybeJson(req.body.policyDetails);

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      if (!policyDetails || typeof policyDetails !== "object") {
        return res
          .status(400)
          .json(new ApiError(400, "Policy details object is required"));
      }

      const query = await LoanQuery.findById(queryId)
        .select(
          "policyDetails customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

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

      const normalizedPolicyDetails = {
        ...policyDetails,
        ...(policyDetails?.coApplicants
          ? { coApplicants: normalizeCoApplicants(policyDetails.coApplicants) }
          : {}),
        ...(policyDetails?.references
          ? { references: normalizeReferenceContacts(policyDetails.references) }
          : {}),
      };

      const updatedByName = await resolveActorDisplayName(actorId, role);

      const activity = {
        type: LoanQueryActivityType.UPDATED,
        description: "Policy details updated",
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: resolveActivityActorModel(role),
        payload: { updatedFields: Object.keys(policyDetails) },
        createdAt: new Date(),
      };

      const updateSet: Record<string, any> = {
        ...(updatedByName ? { updatedByName } : {}),
      };

      Object.entries(normalizedPolicyDetails).forEach(([key, value]) => {
        updateSet[`policyDetails.${key}`] = value;
      });

      const updatedQuery = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: updateSet,
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "policyDetails updatedByName customerId assignedAgent assignedAgents assignedLander ownerAgency channelAgency",
        )
        .lean()
        .exec();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedQuery,
            "Policy details updated successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async reassignLander(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const actorId = (req as any).user?._id;
      const { landerId, reason } = req.body;
      const queryId = req.params.id;

      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can reassign landers"));
      }

      if (!landerId) {
        return res.status(400).json(new ApiError(400, "Lander ID is required"));
      }

      if (
        !Types.ObjectId.isValid(queryId) ||
        !Types.ObjectId.isValid(landerId)
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid query or lander id"));
      }

      const [query, lander, updatedByName] = await Promise.all([
        LoanQuery.findById(queryId).select("assignedLander").lean().exec(),

        Lander.findById(landerId).select("name email").lean().exec(),

        resolveActorDisplayName(actorId, role),
      ]);

      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (!lander) {
        return res.status(404).json(new ApiError(404, "Lander not found"));
      }

      const previousLanderId = (query as any).assignedLander;

      const activity = {
        type: LoanQueryActivityType.LANDER_ASSIGNED,
        description: `Lander reassigned to ${lander.name}${reason ? `: ${reason}` : ""}`,
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
      };

      const updatedQuery = await LoanQuery.findByIdAndUpdate(
        queryId,
        {
          $set: {
            assignedLander: new Types.ObjectId(landerId),
            ...(updatedByName ? { updatedByName } : {}),
          },
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "status updatedByName assignedLander assignedAgent assignedAgents customerId",
        )
        .populate("assignedLander", "name email mobile")
        .lean()
        .exec();

      const loadUpdates: Promise<any>[] = [];

      if (previousLanderId && String(previousLanderId) !== String(landerId)) {
        loadUpdates.push(
          LanderAssignmentEngine.adjustLanderLoad(previousLanderId, -1),
        );
      }

      if (!previousLanderId || String(previousLanderId) !== String(landerId)) {
        loadUpdates.push(
          LanderAssignmentEngine.adjustLanderLoad(
            new Types.ObjectId(landerId),
            1,
          ),
        );
      }

      await Promise.allSettled(loadUpdates);

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedQuery, "Lander reassigned successfully"),
        );
    } catch (err) {
      next(err);
    }
  }

  static async completeQuery(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const actorId = (req as any).user?._id;
      const { remarks } = req.body;
      const queryId = req.params.id;

      if (!Types.ObjectId.isValid(queryId)) {
        return res.status(400).json(new ApiError(400, "Invalid query id"));
      }

      const query = await LoanQuery.findById(queryId)
        .select(
          "status assignedAgent assignedAgents assignedLander customerId ownerAgency channelAgency createdBy",
        )
        .lean()
        .exec();

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

      const oldStatus = query.status;

      const updatedByName = await resolveActorDisplayName(actorId, role);

      const activity = {
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
      };

      const updatedQuery = await LoanQuery.findOneAndUpdate(
        {
          _id: queryId,
          status: { $nin: ["completed", "cancelled"] }, // prevents double complete race condition
        },
        {
          $set: {
            status: "completed",
            ...(updatedByName ? { updatedByName } : {}),
          },
          $push: {
            activities: activity,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
          "status updatedByName assignedAgent assignedAgents assignedLander customerId ownerAgency channelAgency",
        )
        .lean()
        .exec();

      if (!updatedQuery) {
        return res
          .status(400)
          .json(new ApiError(400, "Query is already completed or cancelled"));
      }

      const assignedAgentIds = collectAssignedAgentIds(updatedQuery);

      const loadUpdatePromises: Promise<any>[] = [];

      if (assignedAgentIds.length) {
        loadUpdatePromises.push(
          ...assignedAgentIds.map((agentId) =>
            EmployeeAssignmentEngine.adjustEmployeeLoad(agentId, -1),
          ),
        );
      }

      if (updatedQuery.assignedLander) {
        loadUpdatePromises.push(
          LanderAssignmentEngine.adjustLanderLoad(
            updatedQuery.assignedLander,
            -1,
          ),
        );
      }

      await Promise.allSettled(loadUpdatePromises);

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedQuery,
            "Loan query completed successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }
}
