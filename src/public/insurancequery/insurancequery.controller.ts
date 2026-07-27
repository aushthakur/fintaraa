import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  InsuranceQuery,
  InsuranceType,
} from "../../modals/insurancequery.model";
import {
  ApplicationStatus,
  allowedFieldsByFormType,
  InsuranceFollowUpPriority,
  InsuranceFollowUpStatus,
  InsuranceFollowUpType,
  InsuranceQueryActivityType,
} from "../../modals/insurancequery.model";
import LanderAssignmentEngine from "../../services/landerAssignment.service";
import { Types } from "mongoose";
import Lander from "../../modals/lander.model";
import { User } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import EmployeeAssignmentEngine from "../../services/employeeAssignment.service";
import { leadManagementService } from "../../services/leadManagement.service";
import Admin from "../../modals/admin.model";
import {
  DEFAULT_QUERY_TIMEZONE,
  buildDateRangeInTimeZone,
  parseDateInTimeZone,
} from "../../utils/helper";

const insuranceQueryService = new CommonService(InsuranceQuery);

const syncInsuranceApplicationLead = async (
  result: any,
  customerId: any,
) => {
  if (
    !result ||
    !["b2c_app", "b2b_app"].includes(String(result.dataSource || ""))
  ) {
    return;
  }
  try {
    await leadManagementService.captureLead(
      {
        fullName: `${result.firstName || ""} ${result.lastName || ""}`.trim(),
        email: result.email,
        mobile: result.mobile,
        city: result.city,
        state: result.state,
        pincode: result.pincode,
        whatsappOptIn: result.whatsappConsent,
        tags: ["app_insurance_application", result.typeOfInsurance],
      },
      {
        source: String(result.dataSource),
        channel: "insurance_application",
        externalId: String(result._id),
        actorId: String(customerId),
        skipExternalNotifications: true,
        metadata: {
          insuranceQueryId: String(result._id),
          insuranceType: result.typeOfInsurance,
        },
      },
    );
  } catch (leadError: any) {
    console.error(
      "[Lead Sync] Insurance application lead sync failed:",
      leadError?.message || leadError,
    );
  }
};

const toObjectId = (value: any) => {
  const raw = value?._id || value;
  if (!raw) return null;
  try {
    return new Types.ObjectId(String(raw));
  } catch {
    return null;
  }
};

const resolveDateRange = (
  startRaw: any,
  endRaw: any,
  days: number = 7,
) => {
  return buildDateRangeInTimeZone(
    startRaw,
    endRaw,
    days,
    DEFAULT_QUERY_TIMEZONE,
  );
};

const buildInsuranceScopeMatch = (userId: any, role?: string) => {
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

const getIdString = (value: any) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?._id) return String(value._id);
  return String(value);
};

const normalizeRoleName = (role?: any) =>
  String(role?.name || role || "")
    .trim()
    .toLowerCase();

const formatRoleLabel = (role?: any) => {
  const normalized = normalizeRoleName(role);
  if (!normalized) return "";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const resolveActivityActorModel = (
  role?: string,
): "Admin" | "Agent" | "Lander" | "User" => {
  if (role === "admin") return "Admin";
  if (role === "agent") return "Agent";
  if (role === "lander") return "Lander";
  return "User";
};

const resolveActorDisplayName = async (actorId: any, role?: any) => {
  const id = getIdString(actorId);
  if (!id) return "";

  const selectFields = "name username email mobile";
  const resolveFrom = async (model: any) => {
    const actor = await model.findById(id).select(selectFields).lean();
    if (!actor) return "";
    return actor.name || actor.username || actor.email || actor.mobile || "";
  };

  switch (normalizeRoleName(role)) {
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

const buildInsuranceAuditFields = async (
  actorId: any,
  role?: any,
  includeCreated = false,
) => {
  const normalizedRole = normalizeRoleName(role);
  const actorObjectId = toObjectId(actorId);
  const adminActorId =
    normalizedRole === "admin" || normalizedRole === "agent"
      ? actorObjectId
      : null;
  const actorName = await resolveActorDisplayName(actorId, normalizedRole);
  const actorRole = formatRoleLabel(normalizedRole);

  return {
    ...(includeCreated && actorName ? { createdByName: actorName } : {}),
    ...(includeCreated && actorRole ? { createdByRole: actorRole } : {}),
    ...(includeCreated && adminActorId ? { createdBy: adminActorId } : {}),
    ...(actorName ? { updatedByName: actorName } : {}),
    ...(adminActorId ? { updatedBy: adminActorId } : {}),
  };
};

const applyInsuranceAuditFields = (target: any, auditFields: Record<string, any>) => {
  Object.entries(auditFields || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      target[key] = value;
    }
  });
};

const enrichInsuranceActivityActors = async (activities: any[] = []) => {
  if (!Array.isArray(activities) || activities.length === 0) return activities;

  const actorBuckets = {
    Admin: new Set<string>(),
    Agent: new Set<string>(),
    Lander: new Set<string>(),
    User: new Set<string>(),
  } as Record<"Admin" | "Agent" | "Lander" | "User", Set<string>>;

  activities.forEach((activity) => {
    const actorId = getIdString(activity?.actor);
    const actorModel = activity?.actorModel || "User";
    if (actorId && actorBuckets[actorModel as keyof typeof actorBuckets]) {
      actorBuckets[actorModel as keyof typeof actorBuckets].add(actorId);
    }
  });

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

const terminalInsuranceFollowUpStatuses = new Set<string>([
  ApplicationStatus.APPROVED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.CANCELLED,
  ApplicationStatus.EXPIRED,
  ApplicationStatus.COMPLETED,
  ApplicationStatus.DISBURSED,
  ApplicationStatus.NOT_INTERESTED,
  ApplicationStatus.DROPPED_LOST,
  ApplicationStatus.DUPLICATE,
  ApplicationStatus.REJECTED_BY_BANK,
  ApplicationStatus.COMPLETED_SUCCESS,
  ApplicationStatus.CANCELLED_BY_CUSTOMER,
]);

const isTerminalInsuranceFollowUpStatus = (status?: any) =>
  terminalInsuranceFollowUpStatuses.has(String(status || "").trim());

const normalizeBooleanInput = (value: any): boolean | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off", "disabled"].includes(normalized)) {
    return false;
  }
  return undefined;
};

const normalizeStringInput = (value: any, maxLength = 500) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
};

const normalizeInsuranceFollowUpType = (value: any) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return Object.values(InsuranceFollowUpType).includes(
    normalized as InsuranceFollowUpType,
  )
    ? (normalized as InsuranceFollowUpType)
    : InsuranceFollowUpType.CALL;
};

const normalizeInsuranceFollowUpStatus = (value: any) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return Object.values(InsuranceFollowUpStatus).includes(
    normalized as InsuranceFollowUpStatus,
  )
    ? (normalized as InsuranceFollowUpStatus)
    : InsuranceFollowUpStatus.PENDING;
};

const normalizeInsuranceFollowUpPriority = (value: any) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return Object.values(InsuranceFollowUpPriority).includes(
    normalized as InsuranceFollowUpPriority,
  )
    ? (normalized as InsuranceFollowUpPriority)
    : InsuranceFollowUpPriority.MEDIUM;
};

const parseInsuranceFollowUpDueAt = (value: any) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseDateInTimeZone(value, "start", DEFAULT_QUERY_TIMEZONE);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const getFollowUpObjectId = (value: any) => {
  const objectId = toObjectId(value?._id || value);
  return objectId || undefined;
};

const getPlainInsuranceFollowUp = (value: any) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return { ...value };
};

const hasInsuranceFollowUpPayload = (body: Record<string, any>) =>
  [
    "followUpEnabled",
    "nextFollowUp",
    "followUpAction",
    "followUpStatus",
    "followUpType",
    "followUpReason",
    "followUpPriority",
    "followUpDueAt",
    "followUpAssignedTo",
    "followUpOutcome",
    "followUpRemark",
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));

const removeInsuranceFollowUpPayload = (body: Record<string, any>) => {
  [
    "followUpEnabled",
    "nextFollowUp",
    "followUpAction",
    "followUpStatus",
    "followUpType",
    "followUpReason",
    "followUpPriority",
    "followUpDueAt",
    "followUpAssignedTo",
    "followUpOutcome",
    "followUpRemark",
  ].forEach((key) => delete body[key]);
};

type InsuranceFollowUpMutation = {
  set: Record<string, any>;
  history?: Record<string, any>;
  activity?: Record<string, any>;
};

const buildInsuranceFollowUpActivity = ({
  description,
  actorId,
  role,
  payload,
}: {
  description: string;
  actorId: any;
  role?: string;
  payload?: Record<string, any>;
}) => ({
  type: InsuranceQueryActivityType.FOLLOW_UP_UPDATED,
  description,
  actor: getFollowUpObjectId(actorId),
  actorModel: resolveActivityActorModel(role),
  payload,
  createdAt: new Date(),
});

const buildInsuranceFollowUpMutation = ({
  rawBody,
  existing,
  actorId,
  role,
  actorName,
}: {
  rawBody: Record<string, any>;
  existing: any;
  actorId: any;
  role?: string;
  actorName?: string;
}): InsuranceFollowUpMutation | null => {
  if (!hasInsuranceFollowUpPayload(rawBody)) return null;

  const parsedNext = parseMaybeJson(rawBody.nextFollowUp);
  const next =
    parsedNext && typeof parsedNext === "object" && !Array.isArray(parsedNext)
      ? parsedNext
      : {};
  const existingNext = getPlainInsuranceFollowUp(existing?.nextFollowUp);
  const now = new Date();
  const enabledInput = normalizeBooleanInput(
    rawBody.followUpEnabled ?? next.enabled,
  );
  const action = String(rawBody.followUpAction || next.action || "")
    .trim()
    .toLowerCase();
  const status = normalizeInsuranceFollowUpStatus(
    rawBody.followUpStatus || next.status || existingNext.status,
  );
  const shouldClose =
    enabledInput === false ||
    action === "cancel" ||
    action === "close" ||
    status === InsuranceFollowUpStatus.CANCELLED ||
    status === InsuranceFollowUpStatus.DONE ||
    status === InsuranceFollowUpStatus.MISSED;

  const dueAt =
    parseInsuranceFollowUpDueAt(rawBody.followUpDueAt ?? next.dueAt) ||
    parseInsuranceFollowUpDueAt(existingNext.dueAt);
  const assignedTo =
    getFollowUpObjectId(rawBody.followUpAssignedTo || next.assignedTo) ||
    getFollowUpObjectId(existingNext.assignedTo) ||
    getFollowUpObjectId(existing.assignedAgent);
  const type = normalizeInsuranceFollowUpType(
    rawBody.followUpType || next.type || existingNext.type,
  );
  const priority = normalizeInsuranceFollowUpPriority(
    rawBody.followUpPriority || next.priority || existingNext.priority,
  );
  const reason =
    normalizeStringInput(rawBody.followUpReason ?? next.reason, 240) ||
    normalizeStringInput(existingNext.reason, 240) ||
    "Insurance query follow-up";
  const outcome = normalizeStringInput(
    rawBody.followUpOutcome ?? next.outcome,
    240,
  );
  const remark = normalizeStringInput(
    rawBody.followUpRemark ?? next.remark,
    1000,
  );

  if (!shouldClose) {
    if (!dueAt) {
      throw new ApiError(400, "Callback date/time is required for active follow-up");
    }

    const nextFollowUp = {
      dueAt,
      type,
      reason,
      assignedTo,
      status: InsuranceFollowUpStatus.PENDING,
      priority,
      outcome: outcome || undefined,
      remark: remark || undefined,
      createdAt: existingNext.createdAt || now,
      updatedBy: getFollowUpObjectId(actorId),
      updatedByName: actorName || undefined,
      updatedAt: now,
    };

    return {
      set: {
        followUpEnabled: true,
        nextFollowUp,
      },
      history: {
        dueAt,
        type,
        reason,
        assignedTo,
        status: InsuranceFollowUpStatus.PENDING,
        priority,
        outcome: outcome || undefined,
        remark: remark || undefined,
        action: existing?.followUpEnabled ? "updated" : "scheduled",
        updatedBy: getFollowUpObjectId(actorId),
        updatedByName: actorName || undefined,
        createdAt: now,
      },
      activity: buildInsuranceFollowUpActivity({
        description: existing?.followUpEnabled
          ? "Insurance follow-up updated"
          : "Insurance follow-up scheduled",
        actorId,
        role,
        payload: {
          status: InsuranceFollowUpStatus.PENDING,
          dueAt,
          type,
          priority,
          reason,
        },
      }),
    };
  }

  const closedStatus =
    status === InsuranceFollowUpStatus.DONE
      ? InsuranceFollowUpStatus.DONE
      : status === InsuranceFollowUpStatus.MISSED
        ? InsuranceFollowUpStatus.MISSED
        : InsuranceFollowUpStatus.CANCELLED;
  const actionName =
    closedStatus === InsuranceFollowUpStatus.DONE
      ? "completed"
      : closedStatus === InsuranceFollowUpStatus.MISSED
        ? "missed"
        : "cancelled";
  const nextFollowUp = {
    ...existingNext,
    status: closedStatus,
    outcome: outcome || undefined,
    remark: remark || undefined,
    updatedBy: getFollowUpObjectId(actorId),
    updatedByName: actorName || undefined,
    updatedAt: now,
  };

  return {
    set: {
      followUpEnabled: false,
      nextFollowUp,
    },
    history: {
      dueAt: dueAt || undefined,
      type,
      reason,
      assignedTo,
      status: closedStatus,
      priority,
      outcome: outcome || undefined,
      remark: remark || undefined,
      action: actionName,
      updatedBy: getFollowUpObjectId(actorId),
      updatedByName: actorName || undefined,
      createdAt: now,
    },
    activity: buildInsuranceFollowUpActivity({
      description: `Insurance follow-up ${actionName}`,
      actorId,
      role,
      payload: {
        status: closedStatus,
        action: actionName,
        dueAt,
        type,
        priority,
        reason,
        outcome,
      },
    }),
  };
};

const buildAutoCloseInsuranceFollowUpMutation = ({
  existing,
  actorId,
  role,
  actorName,
  reason,
}: {
  existing: any;
  actorId: any;
  role?: string;
  actorName?: string;
  reason: string;
}): InsuranceFollowUpMutation | null => {
  const existingNext = getPlainInsuranceFollowUp(existing?.nextFollowUp);
  if (
    !existing?.followUpEnabled &&
    existingNext.status !== InsuranceFollowUpStatus.PENDING
  ) {
    return null;
  }

  const now = new Date();
  const dueAt = parseInsuranceFollowUpDueAt(existingNext.dueAt);
  const type = normalizeInsuranceFollowUpType(existingNext.type);
  const priority = normalizeInsuranceFollowUpPriority(existingNext.priority);
  const followUpReason =
    normalizeStringInput(existingNext.reason, 240) ||
    "Insurance query follow-up";
  const nextFollowUp = {
    ...existingNext,
    status: InsuranceFollowUpStatus.CANCELLED,
    outcome: reason,
    updatedBy: getFollowUpObjectId(actorId),
    updatedByName: actorName || undefined,
    updatedAt: now,
  };

  return {
    set: {
      followUpEnabled: false,
      nextFollowUp,
    },
    history: {
      dueAt: dueAt || undefined,
      type,
      reason: followUpReason,
      assignedTo: getFollowUpObjectId(existingNext.assignedTo),
      status: InsuranceFollowUpStatus.CANCELLED,
      priority,
      outcome: reason,
      remark: normalizeStringInput(existingNext.remark, 1000) || undefined,
      action: "cancelled",
      updatedBy: getFollowUpObjectId(actorId),
      updatedByName: actorName || undefined,
      createdAt: now,
    },
    activity: buildInsuranceFollowUpActivity({
      description: "Insurance follow-up auto-closed",
      actorId,
      role,
      payload: {
        status: InsuranceFollowUpStatus.CANCELLED,
        action: "auto_closed",
        reason,
      },
    }),
  };
};

// Helper function to process uploaded files and map to request body
const processFileUploads = (req: Request) => {
  // Initialize policyDetails if it doesn't exist
  req.body.policyDetails = parseMaybeJson(req.body.policyDetails);
  if (!req.body.policyDetails || typeof req.body.policyDetails !== "object") {
    req.body.policyDetails = {};
  }

  // Process kycDocumentUrl (main field)
  if (req.body.kycDocumentUrl) {
    const url = extractFileUrl(req.body.kycDocumentUrl);
    if (url) req.body.kycDocumentUrl = url;
  }

  // Get allowed fields for this insurance type (if typeOfInsurance is provided)
  const typeOfInsurance = req.body.typeOfInsurance;
  const allowedFields = typeOfInsurance ? allowedFieldsByFormType[typeOfInsurance] || [] : [];

  // Process policyDetails document fields (uploaded files/images)
  const documentFields = [
    "healthReports",
    "drivingLicenseUpload",
    "rcBookUpload",
    "medicalReports",
    "medicalReportUpload",
    "propertyDocuments",
    "stockValuationReport",
    "purchaseInvoice",
    "maintenanceRecord",
    "panKycProof",
    "shopLicense",
    "gstCertificate",
  ];

  documentFields.forEach((field) => {
    // Only process if field is allowed for this insurance type (or if typeOfInsurance is not set yet)
    if (req.body[field] && (!typeOfInsurance || allowedFields.includes(field))) {
      if (field === "propertyDocuments" && Array.isArray(req.body[field])) {
        // Handle array of property documents
        req.body.policyDetails[field] = req.body[field]
          .map((file: any) => extractFileUrl(file))
          .filter((url: any) => url);
      } else {
        const url = extractFileUrl(req.body[field]);
        if (url) {
          req.body.policyDetails[field] = url;
        }
      }
      // Remove from body after processing
      delete req.body[field];
    }
  });

  const uploadedInsuranceDocuments = Array.isArray(
    req.body.insuranceDocuments,
  )
    ? req.body.insuranceDocuments
    : req.body.insuranceDocuments
      ? [req.body.insuranceDocuments]
      : [];
  const rawManifest = parseMaybeJson(req.body.insuranceDocumentManifest);
  const manifest = Array.isArray(rawManifest) ? rawManifest.slice(0, 50) : [];

  if (uploadedInsuranceDocuments.length) {
    const existingDocuments = Array.isArray(req.body.policyDetails.documents)
      ? req.body.policyDetails.documents
      : [];
    const nextDocuments = [...existingDocuments];
    let fileOffset = 0;

    const appendDocumentGroup = ({
      key,
      label,
      catalogId,
      catalogKey,
      attachments,
    }: {
      key: string;
      label: string;
      catalogId?: string;
      catalogKey?: string;
      attachments: any[];
    }) => {
      const files = attachments
        .map((attachment: any) => {
          const url = extractFileUrl(attachment);
          if (!url) return null;
          return {
            url,
            name:
              normalizeStringInput(
                attachment?.originalname || attachment?.name || label,
                250,
              ) || label,
            size: Number(attachment?.size) || undefined,
            mimetype:
              normalizeStringInput(attachment?.mimetype, 150) || undefined,
          };
        })
        .filter(Boolean);
      if (!files.length) return;

      const existingIndex = nextDocuments.findIndex(
        (document: any) =>
          String(document?.key || "") === key &&
          String(document?.catalogId || "") === String(catalogId || ""),
      );
      const existingFiles =
        existingIndex >= 0 && Array.isArray(nextDocuments[existingIndex]?.files)
          ? nextDocuments[existingIndex].files
          : [];
      const mergedFiles = [...existingFiles, ...files].filter(
        (file: any, index: number, all: any[]) =>
          all.findIndex(
            (candidate: any) =>
              String(candidate?.url || candidate) ===
              String(file?.url || file),
          ) === index,
      );
      const entry = {
        key,
        label,
        catalogId: catalogId || undefined,
        catalogKey: catalogKey || undefined,
        files: mergedFiles,
      };

      if (existingIndex >= 0) nextDocuments[existingIndex] = entry;
      else nextDocuments.push(entry);

      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (
        ["pancard", "aadhaarcard", "adharcard", "kycdocs"].includes(
          normalizedKey,
        ) &&
        (!req.body.kycDocumentUrl ||
          req.body.kycDocumentUrl === "pending_upload")
      ) {
        req.body.kycDocumentUrl = files[0]?.url;
      }
    };

    manifest.forEach((entry: any) => {
      const requestedCount = Math.max(
        0,
        Math.min(
          Number(entry?.fileCount) || 0,
          uploadedInsuranceDocuments.length - fileOffset,
        ),
      );
      if (!requestedCount) return;
      const key =
        normalizeStringInput(
          entry?.catalogKey || entry?.key || "supporting_document",
          250,
        ) || "supporting_document";
      const label =
        normalizeStringInput(entry?.label, 250) ||
        key.replace(/[_-]+/g, " ");
      appendDocumentGroup({
        key,
        label,
        catalogId:
          normalizeStringInput(entry?.catalogId, 100) || undefined,
        catalogKey:
          normalizeStringInput(entry?.catalogKey, 250) || undefined,
        attachments: uploadedInsuranceDocuments.slice(
          fileOffset,
          fileOffset + requestedCount,
        ),
      });
      fileOffset += requestedCount;
    });

    if (fileOffset < uploadedInsuranceDocuments.length) {
      appendDocumentGroup({
        key: "supporting_document",
        label: "Supporting Document",
        attachments: uploadedInsuranceDocuments.slice(fileOffset),
      });
    }

    req.body.policyDetails.documents = nextDocuments;
  }

  delete req.body.insuranceDocuments;
  delete req.body.insuranceDocumentManifest;
};

const applySavedInsuranceProfileDocuments = (
  body: Record<string, any>,
  user: any,
) => {
  const selections = parseMaybeJson(body.profileDocumentSelections);
  delete body.profileDocumentSelections;
  if (!Array.isArray(selections) || !selections.length) return;

  const profileDocuments = user?.digiLockerVault?.documents || [];
  if (!Array.isArray(profileDocuments) || !profileDocuments.length) return;
  body.policyDetails =
    body.policyDetails && typeof body.policyDetails === "object"
      ? body.policyDetails
      : {};
  const applicationDocuments = Array.isArray(body.policyDetails.documents)
    ? [...body.policyDetails.documents]
    : [];

  selections.slice(0, 50).forEach((selection: any) => {
    const docType = normalizeStringInput(selection?.docType, 250);
    const fileUrl = normalizeStringInput(selection?.fileUrl, 2000);
    if (!docType || !fileUrl) return;
    const ownedDocument = profileDocuments.find(
      (document: any) =>
        String(document?.docType || "") === docType &&
        String(document?.fileUrl || "") === fileUrl,
    );
    if (!ownedDocument) return;

    const key =
      normalizeStringInput(
        selection?.catalogKey || selection?.targetKey || docType,
        250,
      ) || docType;
    const label =
      normalizeStringInput(selection?.label, 250) ||
      normalizeStringInput(selection?.catalogKey, 250) ||
      docType;
    const hasFreshUpload = applicationDocuments.some(
      (entry: any) =>
        String(entry?.key || "") === key &&
        Array.isArray(entry?.files) &&
        entry.files.length > 0,
    );
    if (hasFreshUpload) return;
    const alreadyIncluded = applicationDocuments.some(
      (entry: any) =>
        String(entry?.key || "") === key &&
        (entry?.files || []).some(
          (file: any) => String(file?.url || file) === fileUrl,
        ),
    );
    if (!alreadyIncluded) {
      applicationDocuments.push({
        key,
        label,
        catalogId:
          normalizeStringInput(selection?.catalogId, 100) || undefined,
        catalogKey:
          normalizeStringInput(selection?.catalogKey, 250) || undefined,
        files: [
          {
            url: fileUrl,
            name:
              normalizeStringInput(ownedDocument?.referenceId, 250) || label,
          },
        ],
      });
    }

    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (
      ["pancard", "aadhaarcard", "adharcard", "kycdocs"].includes(
        normalizedKey,
      ) &&
      (!body.kycDocumentUrl || body.kycDocumentUrl === "pending_upload")
    ) {
      body.kycDocumentUrl = fileUrl;
    }
  });

  if (applicationDocuments.length) {
    body.policyDetails.documents = applicationDocuments;
  }
};

const collectReusableInsuranceDocuments = (query: any) => {
  const collected: Array<Record<string, any>> = [];
  const applicationDocuments = Array.isArray(
    query?.policyDetails?.documents,
  )
    ? query.policyDetails.documents
    : [];

  applicationDocuments.forEach((document: any) => {
    const docType =
      normalizeStringInput(
        document?.catalogKey || document?.key || "supporting_document",
        250,
      ) || "supporting_document";
    const files = Array.isArray(document?.files)
      ? document.files
      : document?.files
        ? [document.files]
        : [];
    files.forEach((file: any) => {
      const fileUrl = extractFileUrl(file);
      if (!fileUrl) return;
      collected.push({
        docType,
        fileUrl,
        issuer: "insurance_application",
        referenceId:
          normalizeStringInput(file?.name, 250) ||
          normalizeStringInput(document?.label, 250) ||
          query?.insuranceId ||
          "insurance_application",
        verified: false,
      });
    });
  });

  const kycDocumentUrl = extractFileUrl(query?.kycDocumentUrl);
  if (
    kycDocumentUrl &&
    kycDocumentUrl !== "pending_upload" &&
    !collected.some(
      (document) => String(document.fileUrl) === String(kycDocumentUrl),
    )
  ) {
    collected.push({
      docType: query?.kycDocumentType || "kyc_document",
      fileUrl: kycDocumentUrl,
      issuer: "insurance_application",
      referenceId: query?.insuranceId || "insurance_application",
      verified: false,
    });
  }

  return collected;
};

const syncInsuranceDocumentsToCustomerProfile = async ({
  user,
  query,
}: {
  user: any;
  query: any;
}) => {
  const incomingDocuments = collectReusableInsuranceDocuments(query);
  if (!user || !incomingDocuments.length) return;

  const currentVaultDocuments =
    JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];
  const vaultByIdentity = new Map<string, any>();
  currentVaultDocuments.forEach((document: any) => {
    if (!document?.docType) return;
    vaultByIdentity.set(
      `${document.docType}:${document.fileUrl || document.number || ""}`,
      document,
    );
  });
  incomingDocuments.forEach((document) => {
    vaultByIdentity.set(`${document.docType}:${document.fileUrl}`, document);
  });

  const currentKycDocuments =
    JSON.parse(JSON.stringify(user.kycProfile?.documents || [])) || [];
  const kycByIdentity = new Map<string, any>();
  currentKycDocuments.forEach((document: any) => {
    if (!document?.docType) return;
    kycByIdentity.set(
      `${document.docType}:${document.fileUrl || document.number || ""}`,
      document,
    );
  });
  incomingDocuments.forEach((document) => {
    kycByIdentity.set(`${document.docType}:${document.fileUrl}`, document);
  });

  user.set("digiLockerVault", {
    storageProvider: user.digiLockerVault?.storageProvider || "internal",
    syncedAt: new Date(),
    documents: Array.from(vaultByIdentity.values()),
  });
  user.set("kycProfile.documents", Array.from(kycByIdentity.values()));
  await user.save();
};

const toNumber = (value: any) => {
  if (value === null || value === undefined) return undefined;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
};

const normalizeDateValue = (value: any) => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const raw = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("/").map(Number);
    const parsed = new Date(yyyy, mm - 1, dd);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const splitName = (fullName?: string) => {
  if (!fullName) return { firstName: undefined, lastName: undefined };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift();
  const lastName = parts.join(" ") || undefined;
  return { firstName, lastName };
};

const normalizeInsurancePayload = (
  req: Request,
  user?: any,
  existing?: any
) => {
  const body: any = req.body || {};
  const kyc = user?.kycProfile || {};
  const personal = kyc.personalDetails || {};
  const addressDetails = kyc.addressDetails || {};
  const currentAddress =
    addressDetails.currentAddress || addressDetails.address || {};
  const financial = kyc.financialDetails || {};
  const userAddress =
    Array.isArray(user?.addresses) && user.addresses.length
      ? user.addresses[0]
      : null;

  const pick = (...values: any[]) =>
    values.find(
      (value) => value !== undefined && value !== null && value !== ""
    );

  const nameSource = pick(
    body.fullName,
    body.name,
    body.memberName,
    personal.fullName,
    user?.name
  );
  if (!body.firstName || !body.lastName) {
    const derived = splitName(nameSource);
    if (!body.firstName && derived.firstName) body.firstName = derived.firstName;
    if (!body.lastName && derived.lastName) body.lastName = derived.lastName;
  }

  if (!body.dateOfBirth) {
    body.dateOfBirth = pick(
      body.dob,
      body.birthDate,
      personal.dateOfBirth,
      user?.dateOfBirth
    );
  }
  body.dateOfBirth = normalizeDateValue(body.dateOfBirth);

  body.gender = pick(body.gender, personal.gender, user?.gender);
  body.mobile = pick(body.mobile, body.phone, body.phoneNumber, user?.mobile);
  body.email = pick(body.email, body.emailAddress, user?.email);

  body.fullAddress = pick(
    body.fullAddress,
    body.address,
    body.propertyAddress,
    body.shopAddress,
    currentAddress?.street || currentAddress?.address,
    userAddress?.street || userAddress?.address
  );
  body.city = pick(body.city, currentAddress?.city, userAddress?.city);
  body.state = pick(body.state, currentAddress?.state, userAddress?.state);
  body.pincode = pick(
    body.pincode,
    body.pinCode,
    body.postalCode,
    currentAddress?.postalCode || currentAddress?.pincode || currentAddress?.pinCode,
    userAddress?.postalCode || userAddress?.pincode || userAddress?.pinCode
  );

  if (!body.nomineeName) {
    body.nomineeName = pick(body.nominee, user?.name, "Not Provided");
  }
  if (!body.nomineeRelation) {
    body.nomineeRelation = pick(
      body.nomineeRelation,
      body.nomineeRel,
      body.nomineeRelationship,
      body.relation,
      "self"
    );
  }

  body.occupation = pick(
    body.occupation,
    body.jobTitle,
    kyc.employmentDetails?.employmentType,
    "not_provided"
  );

  const annualIncome = pick(
    toNumber(body.annualIncome),
    toNumber(body.income),
    toNumber(body.salary),
    toNumber(financial.annualIncome)
  );
  const monthlyIncome = pick(
    toNumber(body.monthlyIncome),
    toNumber(body.netIncome),
    toNumber(financial.monthlyIncome)
  );
  if (annualIncome !== undefined) {
    body.annualIncome = annualIncome;
  } else if (monthlyIncome !== undefined) {
    body.annualIncome = Math.round(monthlyIncome * 12);
  } else if (body.annualIncome === undefined || body.annualIncome === null) {
    body.annualIncome = 0;
  }

  const kycDocType = pick(body.kycDocumentType, body.kycDocType, body.documentType);
  if (kycDocType) {
    const normalizedType = String(kycDocType).toLowerCase();
    body.kycDocumentType = ["pan", "aadhaar", "driving_license"].includes(normalizedType)
      ? normalizedType
      : "pan";
  } else if (!body.kycDocumentType) {
    body.kycDocumentType = "pan";
  }

  const kycDocUrl = pick(
    body.kycDocumentUrl,
    body.kycDocs,
    body.kycDocument,
    body.panKycProof,
    user?.panCardUrl,
    user?.aadhaarCardUrl
  );
  if (kycDocUrl && !body.kycDocumentUrl) {
    body.kycDocumentUrl = extractFileUrl(kycDocUrl);
  }

  if (!body.typeOfInsurance) {
    const candidate = pick(body.insuranceType, body.policyType, body.type);
    if (candidate) body.typeOfInsurance = String(candidate).toLowerCase();
  }

  if (existing) {
    const requiredFields = [
      "firstName",
      "lastName",
      "dateOfBirth",
      "gender",
      "mobile",
      "email",
      "fullAddress",
      "pincode",
      "city",
      "state",
      "nomineeName",
      "nomineeRelation",
      "occupation",
      "annualIncome",
      "kycDocumentType",
      "kycDocumentUrl",
      "typeOfInsurance",
    ];
    requiredFields.forEach((field) => {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        body[field] = existing?.[field];
      }
    });
  }
};

export class InsuranceQueryController {
  static async createQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Get customer ID from authenticated user token
      const customerId = (req as any).user?._id;
      const role = (req as any).user?.role;
      if (!customerId) {
        return res
          .status(401)
          .json(new ApiError(401, "User authentication required"));
      }

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Automatically set customerId from token
      req.body.customerId = customerId;
      req.body.dataSource =
        String(req.body.dataSource || req.get("x-source-platform") || "")
          .trim()
          .toLowerCase() || (role === "agency" || role === "agency_member"
          ? "b2b_app"
          : "unknown");
      req.body.formSource =
        String(req.body.formSource || req.body.dataSource).trim() ||
        req.body.dataSource;
      req.body.whatsappConsent =
        req.body.whatsappConsent === true ||
        ["true", "1", "yes"].includes(
          String(req.body.whatsappConsent || "").toLowerCase(),
        );
      req.body.communicationConsent =
        parseMaybeJson(req.body.communicationConsent) || {};
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
      applyInsuranceAuditFields(
        req.body,
        await buildInsuranceAuditFields(customerId, role, true),
      );
      const user = await User.findById(customerId);
      normalizeInsurancePayload(req, user);
      applySavedInsuranceProfileDocuments(req.body, user);

      // Validate policyDetails against typeOfInsurance if both are provided (skip for draft)
      // This must run AFTER processFileUploads since files are moved to policyDetails
      const isDraft = req.body.status === ApplicationStatus.DRAFT;
      const isWebsiteApplication =
        String(req.body.dataSource || "").toLowerCase() === "website" ||
        String(req.body.formSource || "").toLowerCase() ===
          "website_application_flow";
      if (
        !isDraft &&
        !isWebsiteApplication &&
        req.body.typeOfInsurance &&
        req.body.policyDetails &&
        Object.keys(req.body.policyDetails).length > 0
      ) {
        const allowed = allowedFieldsByFormType[req.body.typeOfInsurance] || [];
        const invalidFields = Object.keys(req.body.policyDetails).filter(
          (field) => field !== "documents" && !allowed.includes(field)
        );
        if (invalidFields.length > 0) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                `Field(s) "${invalidFields.join(", ")}" is/are not allowed for ${req.body.typeOfInsurance}. Allowed fields: ${allowed.join(", ")}`
              )
            );
        }
      }

      // Check if user already has an active insurance query with the same typeOfInsurance
      // User can only have one typeOfInsurance until status is completed/approved/cancelled
      if (req.body.typeOfInsurance) {
        const existingQuery = await InsuranceQuery.findOne({
          customerId: customerId,
          typeOfInsurance: req.body.typeOfInsurance,
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
                `You already have an active ${req.body.typeOfInsurance} insurance query. Please complete, approve, or cancel the existing query before creating a new one.`
              )
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
        result = new InsuranceQuery(draftData);
        await result.save({ validateBeforeSave: false });
        
        // Add created activity
        result.activities = result.activities || [];
        result.activities.push({
          type: InsuranceQueryActivityType.CREATED,
          description: "Insurance query created as draft",
          actor: customerId ? new Types.ObjectId(String(customerId)) : undefined,
          actorModel: "User",
          createdAt: new Date(),
        });
        await result.save({ validateBeforeSave: false });
      } else {
        // For non-draft status, use normal validation
        const createData = { ...req.body, activities: [] };
        result = await insuranceQueryService.create(createData);
        
        // Add created activity
        result.activities = result.activities || [];
        result.activities.push({
          type: InsuranceQueryActivityType.CREATED,
          description: "Insurance query created",
          actor: customerId ? new Types.ObjectId(String(customerId)) : undefined,
          actorModel: "User",
          createdAt: new Date(),
        });
        
        const session = (req as any).mongoSession;

        // Auto-assign employee (from Admin model with role=agent)
        if (result && !result.assignedAgent) {
          result = await EmployeeAssignmentEngine.ensureAssignmentForInsuranceQuery(
            result,
            {
              actorId: customerId?.toString(),
              actorModel: "User",
              reason: "new_insurance_query",
              session,
            }
          );
        }

        // Auto-assign lander if not already assigned
        if (result && !result.assignedLander) {
          result = await LanderAssignmentEngine.ensureAssignment(
            result,
            {
              actorId: customerId?.toString(),
              reason: "new_insurance_query",
              session,
            }
          );
        }
        await result.save({ session });
      }

      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create insurance query"));
      try {
        await syncInsuranceDocumentsToCustomerProfile({ user, query: result });
      } catch (profileSyncError: any) {
        console.error(
          "[Insurance Documents] Profile sync failed:",
          profileSyncError?.message || profileSyncError,
        );
      }
      if (
        !isDraft &&
        ["b2c_app", "b2b_app"].includes(String(result.dataSource || ""))
      ) {
        await syncInsuranceApplicationLead(result, customerId);
      }
      return res
        .status(201)
        .json(
          new ApiResponse(201, result, "Insurance query created successfully")
        );
    } catch (err) {
      next(err);
    }
  }

  static async getAllQueries(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      
      // For agents, only show queries assigned to them
      if (role === "agent" && userId) {
        req.query.assignedAgent = userId;
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
      if (req.query.status === "all") {
        delete req.query.status;
      } else if (!req.query.status) {
        req.query.status = { $ne: ApplicationStatus.DRAFT };
      }
      
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
          $lookup: {
            from: "admins",
            localField: "updatedBy",
            foreignField: "_id",
            as: "updatedByData",
          },
        },
        {
          $unwind: {
            path: "$updatedByData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "roles",
            localField: "updatedByData.role",
            foreignField: "_id",
            as: "updatedByRoleData",
          },
        },
        {
          $unwind: {
            path: "$updatedByRoleData",
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
                  name: { $ifNull: ["$assignedAgentData.name", "$assignedAgentData.username"] },
                  email: "$assignedAgentData.email",
                  mobile: "$assignedAgentData.mobile",
                },
                else: "$assignedAgent",
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
            updatedBy: {
              $cond: {
                if: { $ifNull: ["$updatedByData", false] },
                then: {
                  _id: "$updatedByData._id",
                  name: "$updatedByData.name",
                  username: "$updatedByData.username",
                  email: "$updatedByData.email",
                  mobile: "$updatedByData.mobile",
                  role: {
                    _id: "$updatedByRoleData._id",
                    name: "$updatedByRoleData.name",
                  },
                },
                else: "$updatedBy",
              },
            },
          },
        },
        {
          $project: {
            assignedAgentData: 0,
            assignedLanderData: 0,
            createdByData: 0,
            createdByRoleData: 0,
            updatedByData: 0,
            updatedByRoleData: 0,
          },
        },
      ];
      
      const insuranceQueries = await insuranceQueryService.getAll(
        req.query,
        populateStages,
        {
          prependStages: [{ $match: { isDeleted: { $ne: true } } }],
        },
      );
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            insuranceQueries,
            "Insurance queries fetched successfully"
          )
        );
    } catch (err) {
      next(err);
    }
  }

  static async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { typeOfInsurance, startDate, endDate } = req.query as Record<
        string,
        string
      >;

      const normalizedType = typeOfInsurance
        ? String(typeOfInsurance).toLowerCase()
        : "";
      if (
        normalizedType &&
        !Object.values(InsuranceType).includes(
          normalizedType as InsuranceType,
        )
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid typeOfInsurance"));
      }

     
    const start = new Date(startDate);
    const end = new Date(endDate);
      start.setHours(0, 0, 0, 0); // 12:00 AM
      end.setHours(23, 59, 59, 0); // 23:59 PM (end of the day)

      const match: Record<string, any> = {
        isDeleted: { $ne: true },
        createdAt: { $gte: start, $lte: end },
      };

      if (normalizedType) {
        match.typeOfInsurance = normalizedType;
      }

      Object.assign(match, buildInsuranceScopeMatch(userId, role));

      const rows = await InsuranceQuery.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const byStatus: Record<string, number> = {};
      let total = 0;
      rows.forEach((row: any) => {
        const key = row?._id ? String(row._id) : "unknown";
        const count = Number(row?.count) || 0;
        byStatus[key] = count;
        total += count;
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            typeOfInsurance: normalizedType || "all",
            range: {
              startDate: start.toISOString(),
              endDate: end.toISOString(),
            },
            total,
            byStatus,
          },
          "Insurance query stats fetched successfully",
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
      const { startDate, endDate, rangePreset, typeOfInsurance } =
        req.query as Record<string, string>;

      const normalizedType = typeOfInsurance
        ? String(typeOfInsurance).toLowerCase()
        : "";
      if (
        normalizedType &&
        !Object.values(InsuranceType).includes(
          normalizedType as InsuranceType,
        )
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid typeOfInsurance"));
      }

      const toDate = (value?: string): Date | null => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
      };

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isAllTime = rangePreset === "all_time";

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
        }
      };

      if (!isAllTime && (!currentStart || !currentEnd)) {
        applyPreset();
      }

      if (!isAllTime && (!currentStart || !currentEnd)) {
        const end = new Date(today);
        const start = new Date(today);
        start.setDate(start.getDate() - 29);
        currentStart = start;
        currentEnd = end;
      }

      const currentEndFixed =
        !isAllTime && currentEnd ? new Date(currentEnd) : null;
      currentEndFixed?.setHours(23, 59, 59, 999);

      const daysInRange =
        !isAllTime && currentStart && currentEndFixed
          ? Math.max(
              1,
              Math.ceil(
                (currentEndFixed.getTime() - currentStart.getTime()) /
                  (1000 * 60 * 60 * 24) +
                  1,
              ),
            )
          : 0;

      const previousEnd =
        !isAllTime && currentStart ? new Date(currentStart) : null;
      previousEnd?.setDate(previousEnd.getDate() - 1);
      previousEnd?.setHours(23, 59, 59, 999);

      const previousStart = previousEnd ? new Date(previousEnd) : null;
      previousStart?.setDate(previousStart.getDate() - (daysInRange - 1));
      previousStart?.setHours(0, 0, 0, 0);

      const currentMatch: Record<string, any> = {
        isDeleted: { $ne: true },
        status: ApplicationStatus.COMPLETED,
      };
      if (normalizedType) currentMatch.typeOfInsurance = normalizedType;
      if (!isAllTime && currentStart && currentEndFixed) {
        currentMatch.updatedAt = {
          $gte: currentStart,
          $lte: currentEndFixed,
        };
      }
      Object.assign(currentMatch, buildInsuranceScopeMatch(userId, role));

      const previousMatch: Record<string, any> = {
        isDeleted: { $ne: true },
        status: ApplicationStatus.COMPLETED,
      };
      if (normalizedType) previousMatch.typeOfInsurance = normalizedType;
      if (!isAllTime && previousStart && previousEnd) {
        previousMatch.updatedAt = {
          $gte: previousStart,
          $lte: previousEnd,
        };
      }
      Object.assign(previousMatch, buildInsuranceScopeMatch(userId, role));

      const statsPipeline = (match: Record<string, any>) => [
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalAnnualIncome: { $sum: { $ifNull: ["$annualIncome", 0] } },
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
            types: { $addToSet: "$typeOfInsurance" },
          },
        },
      ];

      const [currentAgg, previousAgg] = await Promise.all([
        InsuranceQuery.aggregate(statsPipeline(currentMatch)),
        isAllTime
          ? Promise.resolve([])
          : InsuranceQuery.aggregate(statsPipeline(previousMatch)),
      ]);

      const current = currentAgg?.[0] || {
        total: 0,
        totalAnnualIncome: 0,
        assignedCount: 0,
        types: [],
      };
      const previous = previousAgg?.[0] || {
        total: 0,
      };

      const safePct = (currentValue: number, previousValue: number) => {
        const currentNumber = Number(currentValue) || 0;
        const previousNumber = Number(previousValue) || 0;
        if (previousNumber === 0) return currentNumber === 0 ? 0 : 100;
        return ((currentNumber - previousNumber) / previousNumber) * 100;
      };

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            typeOfInsurance: normalizedType || "all",
            completedRange:
              !isAllTime && currentStart && currentEndFixed
                ? {
                    startDate: currentStart.toISOString(),
                    endDate: currentEndFixed.toISOString(),
                  }
                : null,
            previousCompletedRange:
              !isAllTime && previousStart && previousEnd
                ? {
                    startDate: previousStart.toISOString(),
                    endDate: previousEnd.toISOString(),
                  }
                : null,
            totalCompleted: Number(current.total || 0),
            totalAnnualIncome: Number(current.totalAnnualIncome || 0),
            assignedInView: Number(current.assignedCount || 0),
            typesInView: Array.isArray(current.types)
              ? current.types.filter(Boolean).length
              : 0,
            completedGrowthPercent: isAllTime
              ? 0
              : safePct(current.total, previous.total),
          },
          "Completed insurance premium stats fetched successfully",
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
      const match = buildInsuranceScopeMatch(userId, role);
      Object.assign(match, { isDeleted: { $ne: true } });
      const rows = await InsuranceQuery.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$typeOfInsurance",
            count: { $sum: 1 },
          },
        },
      ]);

      const byType: Record<string, number> = Object.values(InsuranceType).reduce(
        (acc, type) => {
          acc[type] = 0;
          return acc;
        },
        {} as Record<string, number>,
      );

      let total = 0;
      rows.forEach((row: any) => {
        const key = String(row?._id || "").trim();
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
          "Insurance query sidebar counts fetched successfully",
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  static async getQueryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const customerId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      
      const result = await insuranceQueryService.getById(
        req.params.id,
        role !== "admin"
      );
      
      // console.log("customerId", customerId);
      // console.log("result?.customerId?._id", result?.customerId?._id);
      
      // Ensure user can only view their own queries (unless admin)
      if (role !== "admin" && result?.customerId?._id?.toString() !== customerId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only view your own insurance queries"));
      }
      
      if(result?.status !== ApplicationStatus.DRAFT) {
        return res
          .status(404) 
          .json(new ApiError(404, "Only draft queries can be fetched"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Insurance query fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateQueryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const customerId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const elevatedRole = ["admin", "agent", "lander"].includes(role);
      const rawFollowUpBody = { ...(req.body || {}) };
      const hasExplicitFollowUpPayload =
        hasInsuranceFollowUpPayload(rawFollowUpBody);
      
      const existingResult = await insuranceQueryService.getById(
        req.params.id,
        true,
        
      );
      if(existingResult?.status !== ApplicationStatus.DRAFT && !elevatedRole) {
        return res
          .status(400)
          .json(new ApiError(400, "Only draft queries can be updated"));
      }

      const actorId = getIdString(customerId);
      const assignedAgentId = getIdString(
        existingResult.assignedAgent?._id || existingResult.assignedAgent,
      );
      const assignedLanderId = getIdString(
        existingResult.assignedLander?._id || existingResult.assignedLander,
      );
      const queryCustomerId = getIdString(
        existingResult.customerId?._id || existingResult.customerId,
      );

      if (role === "agent" && assignedAgentId !== actorId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update insurance queries assigned to you"));
      }
      if (role === "lander" && assignedLanderId !== actorId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update insurance queries assigned to you"));
      }
      if (
        !elevatedRole &&
        queryCustomerId !== actorId
      ) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update your own insurance queries"));
      }

      removeInsuranceFollowUpPayload(req.body);
      const hasRegularPayload = Object.keys(req.body || {}).length > 0;
      if (hasRegularPayload) {
        processFileUploads(req);
        if (req.body.whatsappConsent !== undefined) {
          req.body.whatsappConsent =
            req.body.whatsappConsent === true ||
            ["true", "1", "yes"].includes(
              String(req.body.whatsappConsent || "").toLowerCase(),
            );
        }
        if (req.body.communicationConsent !== undefined) {
          req.body.communicationConsent =
            parseMaybeJson(req.body.communicationConsent) || {};
        }
      }

      // Prevent changing customerId
      delete req.body.customerId;
      const auditFields = await buildInsuranceAuditFields(customerId, role);
      const actorName = auditFields.updatedByName || "";
      const explicitFollowUpMutation = hasExplicitFollowUpPayload
        ? buildInsuranceFollowUpMutation({
            rawBody: rawFollowUpBody,
            existing: existingResult,
            actorId: customerId,
            role,
            actorName,
          })
        : null;
      const nextStatus = req.body.status || existingResult.status;
      const autoCloseFollowUpMutation =
        !explicitFollowUpMutation &&
        nextStatus !== existingResult.status &&
        isTerminalInsuranceFollowUpStatus(nextStatus)
          ? buildAutoCloseInsuranceFollowUpMutation({
              existing: existingResult,
              actorId: customerId,
              role,
              actorName,
              reason: `Query moved to ${formatRoleLabel(nextStatus) || nextStatus}`,
            })
          : null;
      const followUpMutation =
        explicitFollowUpMutation || autoCloseFollowUpMutation;

      applyInsuranceAuditFields(req.body, auditFields);
      Object.assign(req.body, followUpMutation?.set || {});
      const user = hasRegularPayload ? await User.findById(customerId) : null;
      if (hasRegularPayload) {
        normalizeInsurancePayload(req, user, existingResult);
      }

      // Merge with existing policyDetails if updating
      if (
        hasRegularPayload &&
        req.body.policyDetails &&
        existingResult.policyDetails
      ) {
        req.body.policyDetails = {
          ...existingResult.policyDetails,
          ...req.body.policyDetails,
        };
      }

      const updatedResult = await insuranceQueryService.updateById(
        req.params.id,
        req.body,
        {
          populate: true,
        },
      );
      const isDraftSubmitted =
        existingResult?.status === ApplicationStatus.DRAFT &&
        updatedResult.status !== ApplicationStatus.DRAFT;
      const session = (req as any).mongoSession;
      
      // Track status change
      if (updatedResult && existingResult?.status !== updatedResult.status) {
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: InsuranceQueryActivityType.STATUS_CHANGED,
          description: `Status changed from ${existingResult?.status} to ${updatedResult.status}`,
          actor: getFollowUpObjectId(customerId),
          actorModel: resolveActivityActorModel(role),
          payload: {
            previousStatus: existingResult?.status,
            newStatus: updatedResult.status,
          },
          createdAt: new Date(),
        });
      } else if (!followUpMutation) {
        // Track update if status didn't change
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: InsuranceQueryActivityType.UPDATED,
          description: "Insurance query updated",
          actor: getFollowUpObjectId(customerId),
          actorModel: resolveActivityActorModel(role),
          createdAt: new Date(),
        });
      }

      if (followUpMutation?.history) {
        updatedResult.followUpHistory = updatedResult.followUpHistory || [];
        updatedResult.followUpHistory.push(followUpMutation.history as any);
      }
      if (followUpMutation?.activity) {
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push(followUpMutation.activity as any);
      }
      
      // Auto-assign employee if status changed from draft to non-draft and no employee assigned
      if (
        updatedResult &&
        isDraftSubmitted &&
        !updatedResult.assignedAgent
      ) {
        await EmployeeAssignmentEngine.ensureAssignmentForInsuranceQuery(
          updatedResult as any,
          {
            actorId: customerId?.toString(),
            actorModel: role === "admin" ? "Admin" : "User",
            reason: "draft_submitted",
            session,
          }
        );
      }

      // Auto-assign lander if status changed from draft to non-draft and no lander assigned
      if (
        updatedResult &&
        isDraftSubmitted &&
        !updatedResult.assignedLander
      ) {
        const result = await LanderAssignmentEngine.ensureAssignment(
          updatedResult,
          {
            actorId: customerId?.toString(),
            reason: "draft_submitted",
            session,
          }
        );
        await result.save({ session });
        await syncInsuranceApplicationLead(result, customerId);
        return res
          .status(200)
          .json(new ApiResponse(200, result, "Insurance query updated successfully"));
      }
      
      await updatedResult.save();
      if (isDraftSubmitted) {
        await syncInsuranceApplicationLead(updatedResult, customerId);
      }
      return res
        .status(200)
        .json(new ApiResponse(200, updatedResult, "Insurance query updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteQueryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user || {};
      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can delete insurance queries"));
      }
      const result = await InsuranceQuery.findOneAndUpdate(
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
          .json(new ApiError(404, "Failed to delete insurance query"));
      return res
        .status(200)
        .json(
          new ApiResponse(200, result, "Insurance query deleted successfully")
        );
    } catch (err) {
      next(err);
    }
  }

  static async assignLander(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
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
        return res
          .status(400)
          .json(new ApiError(400, "Lander ID is required"));
      }

      // Check if query exists
      const existingResult = await insuranceQueryService.getById(
        req.params.id,
        true,
      );
      if (!existingResult) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      const actorId = (req as any).user?._id;
      const auditFields = await buildInsuranceAuditFields(actorId, role);

      // Update assignedLander
      const updatedResult = await insuranceQueryService.updateById(
        req.params.id,
        { assignedLander: landerId, ...auditFields },
        {
          populate: [{ path: "assignedLander", select: "name email mobile" }],
        }
      );

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedResult, "Lander assigned successfully")
        );
    } catch (err) {
      next(err);
    }
  }

  static async assignAgent(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user || {};
      const { agentId } = req.body;

      if (role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can assign agents"));
      }

      if (!agentId) {
        return res
          .status(400)
          .json(new ApiError(400, "Agent ID is required"));
      }

      const existingResult = await insuranceQueryService.getById(
        req.params.id,
        true,
      );
      if (!existingResult) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      const agent = await Admin.findById(agentId).populate("role");
      if (!agent) {
        return res.status(404).json(new ApiError(404, "Agent not found"));
      }
      if ((agent as any)?.role?.name !== "agent") {
        return res
          .status(400)
          .json(new ApiError(400, "Selected employee is not an agent"));
      }

      const actorId = (req as any).user?._id;
      const previousAgentId = existingResult.assignedAgent;
      const agentName = (agent as any).name || agent.username || agent.email;
      const auditFields = await buildInsuranceAuditFields(actorId, role);

      const updatedResult = await insuranceQueryService.updateById(
        req.params.id,
        {
          assignedAgent: agentId,
          ...auditFields,
          $push: {
            activities: {
              type: InsuranceQueryActivityType.AGENT_ASSIGNED,
              description: `Agent assigned: ${agentName}${
                previousAgentId ? " (reassigned)" : ""
              }`,
              actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
              actorModel: "Admin",
              payload: {
                agentId,
                agentName,
                previousAgentId: previousAgentId
                  ? String(previousAgentId)
                  : undefined,
                mode: "manual",
              },
              createdAt: new Date(),
            },
          },
        },
        {
          populate: [{ path: "assignedAgent", select: "name username email mobile" }],
        }
      );

      if (
        previousAgentId &&
        previousAgentId.toString() !== agentId.toString()
      ) {
        await EmployeeAssignmentEngine.adjustEmployeeLoad(previousAgentId, -1);
      }
      await EmployeeAssignmentEngine.adjustEmployeeLoad(
        new Types.ObjectId(agentId),
        1
      );

      return res
        .status(200)
        .json(new ApiResponse(200, updatedResult, "Agent assigned successfully"));
    } catch (err) {
      next(err);
    }
  }

  // ====== DETAIL VIEW AND OPERATIONS FOR ADMIN PANEL ======

  static async getQueryDetail(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      
      const query = await InsuranceQuery.findById(req.params.id)
        .populate("customerId", "name email mobile profilePictureUrl")
        .populate("assignedAgent", "name username email mobile profilePictureUrl")
        .populate("assignedLander", "name email mobile profilePictureUrl")
        .lean();

      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      // Check permissions - landers should use their own routes at /lander/*
      if (role === "lander" && query.assignedLander?._id?.toString() !== userId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only view queries assigned to you"));
      }

      const enrichedActivities = await enrichInsuranceActivityActors(
        query.activities || [],
      );

      // Ensure commission fields are always present (for backward compatibility with old documents)
      const responseData = {
        ...query,
        activities: enrichedActivities,
        commissionRecorded: query.commissionRecorded ?? false,
        commissionRecordedAt: query.commissionRecordedAt ?? null,
        commissionTransactionId: query.commissionTransactionId ?? null,
      };

      return res
        .status(200)
        .json(new ApiResponse(200, responseData, "Insurance query details fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async addNote(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { note } = req.body;

      if (!note) {
        return res
          .status(400)
          .json(new ApiError(400, "Note is required"));
      }

      const query = await InsuranceQuery.findById(req.params.id);
      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only add notes to queries assigned to you"));
      }

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.NOTE_ADDED,
        description: note,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        createdAt: new Date(),
      });
      applyInsuranceAuditFields(
        query,
        await buildInsuranceAuditFields(actorId, role),
      );

      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Note added successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { status, remarks } = req.body;

      if (!status) {
        return res
          .status(400)
          .json(new ApiError(400, "Status is required"));
      }

      const query = await InsuranceQuery.findById(req.params.id);
      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      // Check permissions for lander
      if (
        role === "lander" &&
        getIdString(query.assignedLander) !== getIdString(actorId)
      ) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update status of queries assigned to you"));
      }

      const oldStatus = query.status;
      query.status = status;
      const auditFields = await buildInsuranceAuditFields(actorId, role);
      const actorName = auditFields.updatedByName || "";
      const followUpMutation =
        oldStatus !== status && isTerminalInsuranceFollowUpStatus(status)
          ? buildAutoCloseInsuranceFollowUpMutation({
              existing: query,
              actorId,
              role,
              actorName,
              reason: `Query moved to ${formatRoleLabel(status) || status}`,
            })
          : null;
      applyInsuranceAuditFields(query, auditFields);
      if (followUpMutation?.set) {
        query.set(followUpMutation.set);
      }

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.STATUS_CHANGED,
        description: `Status changed from ${oldStatus} to ${status}${remarks ? `: ${remarks}` : ""}`,
        actor: getFollowUpObjectId(actorId),
        actorModel: resolveActivityActorModel(role),
        payload: {
          oldStatus,
          newStatus: status,
          remarks,
        },
        createdAt: new Date(),
      });
      if (followUpMutation?.history) {
        query.followUpHistory = query.followUpHistory || [];
        query.followUpHistory.push(followUpMutation.history as any);
      }
      if (followUpMutation?.activity) {
        query.activities.push(followUpMutation.activity as any);
      }

      await query.save();

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
    next: NextFunction
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await InsuranceQuery.findById(req.params.id);
      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update documents of queries assigned to you"));
      }

      processFileUploads(req);

      // Initialize policy details if not exists
      if (!query.policyDetails) {
        query.policyDetails = {};
      }

      // Handle file uploads from multer/S3 middleware
      const documentTypes = [
        "healthReports", "drivingLicenseUpload", "rcBookUpload", "medicalReports",
        "propertyDocuments", "stockValuationReport", "purchaseInvoice",
        "maintenanceRecord", "panKycProof", "shopLicense", "gstCertificate"
      ];

      const uploadedDocs: string[] = [];
      documentTypes.forEach((docType) => {
        const processedValue = req.body.policyDetails?.[docType];
        if (processedValue) {
          if (query.policyDetails) {
            query.policyDetails[docType] = processedValue;
            uploadedDocs.push(docType);
          }
        }
      });

      const processedDocuments = Array.isArray(
        req.body.policyDetails?.documents,
      )
        ? req.body.policyDetails.documents
        : [];
      if (processedDocuments.length && query.policyDetails) {
        const currentDocuments = Array.isArray(query.policyDetails.documents)
          ? query.policyDetails.documents
          : [];
        const documentByIdentity = new Map<string, any>();
        [...currentDocuments, ...processedDocuments].forEach(
          (document: any) => {
            const firstUrl = extractFileUrl(document?.files?.[0]) || "";
            documentByIdentity.set(
              `${document?.key || "supporting_document"}:${firstUrl}`,
              document,
            );
          },
        );
        query.policyDetails.documents = Array.from(
          documentByIdentity.values(),
        );
        uploadedDocs.push(
          ...processedDocuments.map(
            (document: any) => document?.label || document?.key || "document",
          ),
        );
      }

      // Also support direct URL input
      if (req.body.documentUrl && req.body.documentType && query.policyDetails) {
        query.policyDetails[req.body.documentType] = req.body.documentUrl;
        uploadedDocs.push(req.body.documentType);
      }

      if (uploadedDocs.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No documents provided"));
      }

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.DOCUMENT_UPLOADED,
        description: `Documents uploaded: ${uploadedDocs.join(", ")}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: { uploadedDocuments: uploadedDocs },
        createdAt: new Date(),
      });
      applyInsuranceAuditFields(
        query,
        await buildInsuranceAuditFields(actorId, role),
      );

      query.markModified("policyDetails");
      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Documents updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePolicyDetails(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { policyDetails } = req.body;

      if (!policyDetails || typeof policyDetails !== "object") {
        return res
          .status(400)
          .json(new ApiError(400, "Policy details object is required"));
      }

      const query = await InsuranceQuery.findById(req.params.id);
      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update policy details of queries assigned to you"));
      }

      // Merge policy details
      query.policyDetails = { ...query.policyDetails, ...policyDetails };
      applyInsuranceAuditFields(
        query,
        await buildInsuranceAuditFields(actorId, role),
      );

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.UPDATED,
        description: `Policy details updated`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: { updatedFields: Object.keys(policyDetails) },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Policy details updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async reassignLander(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
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
        return res
          .status(400)
          .json(new ApiError(400, "Lander ID is required"));
      }

      const query = await InsuranceQuery.findById(req.params.id);
      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      const actorId = (req as any).user?._id;
      const previousLanderId = query.assignedLander;

      query.assignedLander = new Types.ObjectId(landerId);
      applyInsuranceAuditFields(
        query,
        await buildInsuranceAuditFields(actorId, role),
      );

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.LANDER_ASSIGNED,
        description: `Lander reassigned${reason ? `: ${reason}` : ""}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: "Admin",
        payload: {
          landerId,
          previousLanderId: previousLanderId ? String(previousLanderId) : undefined,
          reason,
        },
        createdAt: new Date(),
      });

      await query.save();

      // Adjust lander loads
      if (previousLanderId && previousLanderId.toString() !== landerId.toString()) {
        await LanderAssignmentEngine.adjustLanderLoad(previousLanderId, -1);
      }
      await LanderAssignmentEngine.adjustLanderLoad(new Types.ObjectId(landerId), 1);

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Lander reassigned successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async completeQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user || {};
      const actorId = (req as any).user?._id;
      const { remarks } = req.body;

      // Only admin or assigned lander can complete a query
      const query = await InsuranceQuery.findById(req.params.id);
      if (!query) {
        return res
          .status(404)
          .json(new ApiError(404, "Insurance query not found"));
      }

      // Check permissions for lander
      if (
        role === "lander" &&
        getIdString(query.assignedLander) !== getIdString(actorId)
      ) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only complete queries assigned to you"));
      }

      // Check if query is in a valid state to be completed
      if (query.status === ApplicationStatus.COMPLETED) {
        return res
          .status(400)
          .json(new ApiError(400, "Query is already completed"));
      }

      if (query.status === ApplicationStatus.CANCELLED) {
        return res
          .status(400)
          .json(new ApiError(400, "Cannot complete a cancelled query"));
      }

      console.log(`🏁 Completing insurance query ${query._id}`);
      console.log(`  Current status: ${query.status}`);
      console.log(`  Completed by: ${role} (${actorId})`);
      console.log(`  Assigned Lander: ${query.assignedLander}`);

      const oldStatus = query.status;
      query.status = ApplicationStatus.COMPLETED;
      const auditFields = await buildInsuranceAuditFields(actorId, role);
      const actorName = auditFields.updatedByName || "";
      const followUpMutation = buildAutoCloseInsuranceFollowUpMutation({
        existing: query,
        actorId,
        role,
        actorName,
        reason: "Query completed",
      });
      applyInsuranceAuditFields(query, auditFields);
      if (followUpMutation?.set) {
        query.set(followUpMutation.set);
      }

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.STATUS_CHANGED,
        description: `Query completed${remarks ? `: ${remarks}` : ""}`,
        actor: getFollowUpObjectId(actorId),
        actorModel: resolveActivityActorModel(role),
        payload: {
          oldStatus,
          newStatus: ApplicationStatus.COMPLETED,
          remarks,
        },
        createdAt: new Date(),
      });
      if (followUpMutation?.history) {
        query.followUpHistory = query.followUpHistory || [];
        query.followUpHistory.push(followUpMutation.history as any);
      }
      if (followUpMutation?.activity) {
        query.activities.push(followUpMutation.activity as any);
      }

      await query.save();

      // Adjust lander load - reduce by 1 as this query is now completed
      if (query.assignedAgent) {
        await EmployeeAssignmentEngine.adjustEmployeeLoad(query.assignedAgent, -1);
      }
      if (query.assignedLander) {
        console.log(`  📉 Adjusting lander load for ${query.assignedLander}`);
        await LanderAssignmentEngine.adjustLanderLoad(
          query.assignedLander,
          -1
        );
        console.log(`  ✅ Lander load decreased`);
      }

      console.log(`✅ Insurance query ${query._id} marked as completed`);

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Insurance query completed successfully"));
    } catch (err) {
      next(err);
    }
  }
}
