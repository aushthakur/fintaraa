import { Types } from "mongoose";
import ApiError from "../../utils/ApiError";
import Admin from "../../modals/admin.model";
import Ticket from "../../modals/ticket.model";
import ApiResponse from "../../utils/ApiResponse";
import { LoanQuery } from "../../modals/loanquery.model";
import { Request, Response, NextFunction } from "express";
import { UserType } from "../../modals/notification.model";
import { CommonService } from "../../services/common.services";
import {
  Gender,
  User,
  UserStatus,
  AccountSource,
} from "../../modals/user.model";
import { CallRecord, ICallRecord } from "../../modals/callRecord.model";
import { sendSingleNotification } from "../../services/notification.service";
import {
  InsuranceType,
  InsuranceQuery,
  InsuranceQueryActivityType,
  ApplicationStatus as InsuranceApplicationStatus,
} from "../../modals/insurancequery.model";
import { Agency } from "../../modals/agency.model";
import Lead, { LeadConnectorType } from "../../modals/lead.model";
import { leadManagementService } from "../../services/leadManagement.service";
import EmployeeAssignmentEngine from "../../services/employeeAssignment.service";
import {
  normalizeLoanType,
  getLoanTypeMatchValues,
} from "../../utils/loanType";
import {
  parseDateInTimeZone,
  formatDateInTimeZone,
  DEFAULT_QUERY_TIMEZONE,
} from "../../utils/helper";

const CallRecordService = new CommonService<ICallRecord>(CallRecord as any);

const toObjectId = (value: any): Types.ObjectId | null => {
  const raw = value?._id || value;
  if (!raw) return null;
  try {
    return new Types.ObjectId(String(raw));
  } catch {
    return null;
  }
};

const buildCallRecordScopeMatch = (
  userId: any,
  role?: string,
  scope: "created" | "assigned" = "assigned",
) => {
  const match: Record<string, any> = {};
  if (role === "admin") return match;

  const objectId = toObjectId(userId);
  if (!objectId) return { _id: null };

  if (role === "agent") {
    if (scope === "created") {
      match.createdBy = objectId;
    } else {
      match.$or = [{ assignee: objectId }, { assignees: objectId }];
    }
  } else {
    match.createdBy = objectId;
  }

  return match;
};

const normalizePhoneDigits = (input?: string): string => {
  return String(input || "").replace(/\D/g, "");
};

const normalizePhoneToLeadFormat = (input?: string): string => {
  const digits = normalizePhoneDigits(input);
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length > 10) return `+91${digits.slice(-10)}`;
  return `+${digits}`;
};

const buildPhoneCandidates = (input?: string): string[] => {
  const digits = normalizePhoneDigits(input);
  if (!digits) return [];
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  return Array.from(
    new Set([
      digits,
      last10,
      `+91${last10}`,
      `91${last10}`,
      `0${last10}`,
      `+${digits}`,
    ]),
  );
};

const normalizeObjectIdArray = (value: any): Types.ObjectId[] => {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  return rawValues
    .map((item) => {
      const id = String(item?._id || item || "").trim();
      if (!id || !Types.ObjectId.isValid(id)) return null;
      return new Types.ObjectId(id);
    })
    .filter((item): item is Types.ObjectId => Boolean(item));
};

const normalizeEmploymentTypeForCallRecord = (value: any) => {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (key === "salaried" || key === "salary") return "salaried";
  if (
    [
      "selfemployedprofessional",
      "selfemployedpro",
      "selfprofessional",
    ].includes(key)
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
  return key;
};

const sanitizeCallRecordPayload = (payload: Record<string, any>) => {
  const next = { ...payload };
  const employmentType = normalizeEmploymentTypeForCallRecord(
    next.employmentType,
  );

  if (Object.prototype.hasOwnProperty.call(next, "callbackAt")) {
    const callbackAt = parseDateInTimeZone(
      next.callbackAt,
      "start",
      DEFAULT_QUERY_TIMEZONE,
    );
    if (callbackAt) {
      next.callbackAt = callbackAt;
    } else {
      delete next.callbackAt;
    }
  }

  const sharedFields = [
    "businessType",
    "coApplicantType",
    "totalVintage",
    "currentVintage",
    "btBankName",
  ];
  const nonProfessionalOnlyFields = ["natureOfBusiness", "gstTurnover"];
  const professionalOnlyFields = ["natureOfProfession", "totalReceipts"];

  const clearFields = (fields: string[]) => {
    fields.forEach((field) => {
      delete next[field];
    });
  };

  if (employmentType === "salaried") {
    clearFields([
      ...sharedFields,
      ...nonProfessionalOnlyFields,
      ...professionalOnlyFields,
    ]);
    return next;
  }

  if (employmentType === "self_employed_non_professional") {
    clearFields(professionalOnlyFields);
    return next;
  }

  if (employmentType === "self_employed_professional") {
    clearFields(nonProfessionalOnlyFields);
    return next;
  }

  return next;
};

const resolveAdminDisplayName = async (adminId?: string) => {
  if (!adminId) return "";
  const admin = await Admin.findById(adminId)
    .select("name username email")
    .lean();
  return admin?.name || admin?.username || admin?.email || "";
};

const stringifyValue = (value: any): string => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const buildChangeDiff = (
  before: Record<string, any>,
  after: Record<string, any>,
  keys: string[],
) => {
  const changes: Array<{
    field: string;
    before: string;
    after: string;
  }> = [];

  for (const key of keys) {
    const prev = before?.[key];
    const next = after?.[key];
    if (stringifyValue(prev) === stringifyValue(next)) continue;
    changes.push({
      field: key,
      before: stringifyValue(prev),
      after: stringifyValue(next),
    });
  }

  return changes;
};

const buildFollowUpHistoryEntry = (
  record: ICallRecord,
  actorId?: string,
  actorName?: string,
  closingRemark?: string,
  callbackAt?: Date,
) => {
  const now = new Date();
  const openingRemark = String(
    record.comment || record.contactActionStatus || "",
  ).trim();

  return {
    openedBy:
      record.createdBy || (actorId ? new Types.ObjectId(actorId) : undefined),
    closedBy: actorId ? new Types.ObjectId(actorId) : undefined,
    openedByName: (record as any)?.createdBy?.name || actorName || undefined,
    closedByName: actorName,
    openedAt: record.createdAt || now,
    closedAt: now,
    openingRemark: openingRemark || undefined,
    closingRemark: closingRemark || undefined,
    assignedTo: record.assignee || undefined,
    assignedToName:
      (record as any)?.assignee?.name ||
      (record as any)?.assigneeName ||
      undefined,
    callbackAt: callbackAt || record.callbackAt || undefined,
  };
};

const normalizeCallRecordAssigneeView = (record: any) => {
  if (!record) return record;

  const toId = (value: any) =>
    String(value?._id || value?.id || value || "").trim();

  const assigneesDetails = Array.isArray(record?.assigneesDetails)
    ? record.assigneesDetails
    : Array.isArray(record?.assignees)
      ? record.assignees.filter(
          (agent: any) => agent && typeof agent === "object",
        )
      : [];

  let assigneeDetails =
    record?.assigneeDetails ||
    (record?.assignee && typeof record.assignee === "object"
      ? record.assignee
      : null);

  if (!assigneeDetails && record?.assignee) {
    const assigneeId = toId(record.assignee);
    assigneeDetails =
      assigneesDetails.find((agent: any) => toId(agent) === assigneeId) || null;
  }

  const normalizedAssigneesDetails =
    assigneesDetails.length > 0
      ? assigneesDetails
      : assigneeDetails
        ? [assigneeDetails]
        : [];

  return {
    ...record,
    assigneeDetails: assigneeDetails || undefined,
    assigneesDetails: normalizedAssigneesDetails,
    assigneeCount:
      Number(record?.assigneeCount || normalizedAssigneesDetails.length || 0) ||
      normalizedAssigneesDetails.length,
  };
};

const enrichCallRecordsWithCustomerContext = async (records: any[]) => {
  if (!Array.isArray(records) || records.length === 0) return records;

  const candidateSet = new Set<string>();
  const recordCandidates = new Map<string, string[]>();

  for (const record of records) {
    const candidates = buildPhoneCandidates(record?.phoneNumber);
    if (!candidates.length) continue;
    const recordId = String(record?._id || "");
    recordCandidates.set(recordId, candidates);
    candidates.forEach((candidate) => candidateSet.add(candidate));
  }

  if (candidateSet.size === 0) return records;

  const users = await User.find({
    mobile: { $in: Array.from(candidateSet) },
  })
    .select("_id mobile name email status isMobileVerified createdAt updatedAt")
    .lean();

  const userLookup = new Map<string, any>();
  for (const user of users as any[]) {
    for (const candidate of buildPhoneCandidates(user?.mobile)) {
      if (!userLookup.has(candidate)) {
        userLookup.set(candidate, user);
      }
    }
  }

  const userIds = users
    .map((user: any) => user?._id?.toString?.() || String(user?._id || ""))
    .filter(Boolean);

  const openTickets = userIds.length
    ? await Ticket.find({
        requester: { $in: userIds },
        status: { $in: ["open", "re_assigned"] },
      })
        .select("requester status title dueDate createdAt updatedAt")
        .lean()
    : [];

  const openTicketCountByUser = new Map<string, number>();
  for (const ticket of openTickets as any[]) {
    const requesterId = String(ticket?.requester || "");
    if (!requesterId) continue;
    openTicketCountByUser.set(
      requesterId,
      (openTicketCountByUser.get(requesterId) || 0) + 1,
    );
  }

  return records.map((record) => {
    const recordId = String(record?._id || "");
    const candidates =
      recordCandidates.get(recordId) ||
      buildPhoneCandidates(record?.phoneNumber);
    const matchedUser = candidates
      .map((candidate) => userLookup.get(candidate))
      .find(Boolean);
    const matchedUserId = matchedUser?._id?.toString?.() || "";
    const openTicketCount = matchedUserId
      ? openTicketCountByUser.get(matchedUserId) || 0
      : 0;

    return {
      ...record,
      openTicketCount,
      openTicketLabel: openTicketCount
        ? `${openTicketCount} Open Ticket${openTicketCount === 1 ? "" : "s"}`
        : "No Open Ticket",
      customerProfile: matchedUser
        ? {
            id: matchedUserId,
            name:
              matchedUser.name ||
              matchedUser.email ||
              record?.firstName ||
              "B2C Customer",
            email: matchedUser.email || "",
            mobile: matchedUser.mobile || record?.phoneNumber || "",
            status: matchedUser.status || "active",
            isMobileVerified: matchedUser.isMobileVerified !== false,
            registered: true,
            registrationLabel: "Registered on B2C App",
            sourceLabel:
              matchedUser.isMobileVerified !== false
                ? "Verified B2C App user"
                : "B2C App user",
          }
        : {
            registered: false,
            registrationLabel: "Not registered on B2C App",
            sourceLabel: "No B2C App profile found",
          },
    };
  });
};

const shouldIncludeCustomerContext = (value: unknown) => {
  const normalized = String(value ?? "true")
    .trim()
    .toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
};

const shouldDeferCallRecordLookups = (query: Record<string, any>) => {
  const lookupSensitiveValues = [
    query.searchkey,
    query.sortKey,
    query.multiSort,
  ];

  const usesNestedField = (value: unknown) =>
    String(value ?? "")
      .split(",")
      .map((part) => part.trim().split(":")[0].trim())
      .filter(Boolean)
      .some((field) => field.includes("."));

  if (lookupSensitiveValues.some(usesNestedField)) return false;

  return !Object.keys(query).some((key) => {
    if (!key || key.startsWith("_")) return false;
    const baseKey = key.split("__")[0].trim();
    return baseKey.includes(".");
  });
};

const buildSourceTag = (value?: string): string | null => {
  const source = String(value || "")
    .trim()
    .toLowerCase();
  if (!source) return null;
  const sanitized = source.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!sanitized) return null;
  return `channel_source_${sanitized}`;
};

const findAgencyByPhone = async (phoneNumber?: string) => {
  const digits = normalizePhoneDigits(phoneNumber);
  if (!digits) return null;

  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  const candidates = Array.from(
    new Set([digits, last10, `+91${last10}`, `91${last10}`, `0${last10}`]),
  );

  const escapedLast10 = last10.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedLast10}$`, "i");

  return Agency.findOne({
    $or: [{ mobile: { $in: candidates } }, { mobile: { $regex: regex } }],
  });
};

const resolveOwningAgency = async (agency: any) => {
  if (!agency) return null;
  if (agency.role === "agency") return agency;
  if (agency.role === "agency_member" && agency.parentAgency) {
    const parent = await Agency.findById(agency.parentAgency);
    return parent || agency;
  }
  return agency;
};

const attachLeadToAgencyFromSource = async (
  callRecord: ICallRecord,
  actorId?: string,
) => {
  const dataSource = String(callRecord?.dataSource || "").trim();
  if (!dataSource) return null;

  const matchedAgency = await findAgencyByPhone(callRecord?.phoneNumber);
  if (!matchedAgency) return null;

  const owningAgency = await resolveOwningAgency(matchedAgency);
  if (!owningAgency) return null;

  const fullName =
    `${callRecord.firstName || ""} ${callRecord.lastName || ""}`.trim() ||
    `Lead ${normalizePhoneDigits(callRecord.phoneNumber).slice(-4)}`;

  const sourceTag = buildSourceTag(dataSource);
  const leadPayload: Record<string, any> = {
    firstName: callRecord.firstName,
    lastName: callRecord.lastName,
    fullName,
    mobile: normalizePhoneToLeadFormat(callRecord.phoneNumber),
    email: callRecord.email,
    city: callRecord.city,
    state: callRecord.state,
    pincode: callRecord.pincode,
    loanAmount: callRecord.loanAmount,
    loanType: callRecord.productService,
    productType: callRecord.productService,
    loanPurpose: callRecord.productService,
    channel: dataSource,
    campaignName: dataSource,
    affiliateId: owningAgency._id.toString(),
    tags: [
      "call_record",
      "channel_management",
      ...(sourceTag ? [sourceTag] : []),
    ],
    callRecordId: callRecord._id?.toString(),
    agencyId: owningAgency._id.toString(),
    agencyName: owningAgency.name,
    agencyRole: owningAgency.role,
    agencyMobile: owningAgency.mobile,
  };

  const captured = await leadManagementService.captureLead(leadPayload, {
    source: LeadConnectorType.MANUAL,
    channel: dataSource,
    actorId,
  });

  const lead = captured?.lead;
  if (lead?._id) {
    await Lead.findByIdAndUpdate(lead._id, {
      $set: {
        "capturedFrom.channel": dataSource,
        "capturedFrom.affiliateId": owningAgency._id.toString(),
        "metadata.channelAgencyId": owningAgency._id.toString(),
        "metadata.channelAgencyName": owningAgency.name,
        "metadata.channelAgencyPhone": owningAgency.mobile,
        "metadata.channelSource": dataSource,
        "metadata.callRecordId": callRecord._id?.toString(),
      },
      $addToSet: {
        tags: {
          $each: [
            "call_record",
            "channel_management",
            ...(sourceTag ? [sourceTag] : []),
          ],
        },
      },
    });
  }

  const callRecordUpdate: Record<string, any> = {
    channelAgency: owningAgency._id,
    channelMatchedAt: new Date(),
  };
  if (lead?._id) callRecordUpdate.attachedLead = lead._id;

  const updatedRecord = await CallRecord.findByIdAndUpdate(
    callRecord._id,
    { $set: callRecordUpdate },
    { new: true },
  );

  return {
    agency: owningAgency,
    lead,
    callRecord: updatedRecord || callRecord,
    created: captured?.created,
  };
};

const getFollowUpBucketFilter = (
  bucketRaw?: string | string[],
  timeZone = DEFAULT_QUERY_TIMEZONE,
): Record<string, any> | null => {
  const bucket = String(bucketRaw || "")
    .trim()
    .toLowerCase();
  if (!bucket) return null;

  if (bucket === "followup" || bucket === "followups") {
    return {
      followUp: true,
    };
  }

  const now = new Date();
  const todayKey = formatDateInTimeZone(now, timeZone);
  const startOfToday = parseDateInTimeZone(todayKey, "start", timeZone);
  const endOfToday = parseDateInTimeZone(todayKey, "end", timeZone);

  if (!startOfToday || !endOfToday) return null;

  if (bucket === "today") {
    return {
      followUp: true,
      callbackAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    };
  }

  if (bucket === "upcoming") {
    return {
      followUp: true,
      callbackAt: {
        $gt: endOfToday,
      },
    };
  }

  if (bucket === "missed") {
    return {
      followUp: true,
      callbackAt: {
        $lt: startOfToday,
        $ne: null,
      },
    };
  }

  return null;
};

const INSURANCE_PRODUCT_MAP: Record<string, InsuranceType> = {
  health_insurance: InsuranceType.HEALTH,
  life_insurance: InsuranceType.LIFE,
  term_insurance: InsuranceType.TERM,
  vehicle_insurance: InsuranceType.VEHICLE,
  property_insurance: InsuranceType.PROPERTY,
  stock_insurance: InsuranceType.STOCK,
  machine_insurance: InsuranceType.MACHINERY,
  travel_insurance: InsuranceType.TRAVEL,
  retirement_plan: InsuranceType.RETIREMENT,
  shop_insurance: InsuranceType.SHOP,
  personal_accident: InsuranceType.HEALTH,
  critical_illness: InsuranceType.HEALTH,
  group_insurance: InsuranceType.HEALTH,
  cyber_insurance: InsuranceType.PROPERTY,
  pet_insurance: InsuranceType.PROPERTY,
  loan_suraksha: InsuranceType.TERM,
  all_insurance: InsuranceType.HEALTH,
};

const normalizeInsuranceTypeFromProductService = (
  productService?: string,
): InsuranceType | undefined => {
  if (!productService) return undefined;
  const normalized = String(productService).trim().toLowerCase();
  return INSURANCE_PRODUCT_MAP[normalized];
};

// Create loan query from call record data
const createLoanQueryFromCallRecord = async (
  callRecord: ICallRecord,
  context?: Record<string, any>,
  lead?: any,
): Promise<any> => {
  try {
    const phoneNumber = callRecord.phoneNumber;
    if (!phoneNumber) return null;

    // Normalize phone number - get last 10 digits
    const normalizedPhone = phoneNumber.replace(/\D/g, "");
    const searchPhone =
      normalizedPhone.length > 10
        ? normalizedPhone.slice(-10)
        : normalizedPhone;

    const normalizedLoanContext = context || {};
    const requestedProductService = String(
      normalizedLoanContext.productService || callRecord.productService || "",
    ).trim();
    const loanType =
      normalizeLoanType(normalizedLoanContext.loanType) ||
      normalizeLoanType(requestedProductService);
    if (!loanType) return null;
    const primaryAssigneeId = toObjectId(
      context?.assignee || callRecord.assignee || callRecord.assignees?.[0],
    );

    const contextQueryId = String(
      normalizedLoanContext.queryId ||
        normalizedLoanContext.loanQueryId ||
        normalizedLoanContext.id ||
        "",
    ).trim();
    if (contextQueryId) {
      const existingById = await LoanQuery.findById(contextQueryId);
      if (existingById && existingById.loanType === loanType) {
        return existingById;
      }
      if (existingById && existingById.loanType !== loanType) {
        console.log(
          "[CallRecord] Existing loan context has different loan type; creating new loan query",
          {
            existingLoanType: existingById.loanType,
            requestedLoanType: loanType,
            contextQueryId,
          },
        );
      }
    }

    if (callRecord.loanQueryId) {
      const linkedLoanQuery = await LoanQuery.findById(callRecord.loanQueryId);
      if (linkedLoanQuery && linkedLoanQuery.loanType === loanType) {
        return linkedLoanQuery;
      }
    }

    const existingByContact = await LoanQuery.findOne({
      loanType,
      status: {
        $nin: ["completed", "completed_success", "approved", "cancelled"],
      },
      ...(primaryAssigneeId ? { assignedAgent: primaryAssigneeId } : {}),
      $or: [
        { mobile: { $regex: searchPhone, $options: "i" } },
        { mobile: phoneNumber },
        ...(normalizedLoanContext.email
          ? [
              {
                email: String(normalizedLoanContext.email).trim().toLowerCase(),
              },
            ]
          : []),
      ],
    });
    if (existingByContact) return existingByContact;

    const findOrCreateUser = async () => {
      if (lead?.borrowerProfile) {
        const borrowerByLead = await User.findById(lead.borrowerProfile);
        if (borrowerByLead) return borrowerByLead;
      }
      if (normalizedLoanContext.customerId) {
        const customerId = String(normalizedLoanContext.customerId).trim();
        if (customerId) {
          const borrowerByContext = await User.findById(customerId);
          if (borrowerByContext) return borrowerByContext;
        }
      }

      const lookup = [
        { mobile: { $regex: searchPhone, $options: "i" } },
        { mobile: phoneNumber },
      ];
      const existingUser = await User.findOne({ $or: lookup });
      if (existingUser) return existingUser;

      const fallbackName =
        `${callRecord.firstName || lead?.fullName || ""} ${callRecord.lastName || ""}`.trim() ||
        `Lead ${searchPhone.slice(-4) || phoneNumber.slice(-4)}`;

      const createdUser = new User({
        name: fallbackName,
        email: undefined,
        mobile: phoneNumber,
        role: "user",
        agreedToTerms: true,
        privacyPolicyAccepted: true,
        gender: Gender.PREFER_NOT_TO_SAY,
        accountSource: AccountSource.ADMIN,
        status: UserStatus.PENDING_VERIFICATION,
      } as any);

      await createdUser.save();
      console.log(
        "[CallRecord] Created fallback borrower profile for phone:",
        phoneNumber,
      );
      return createdUser;
    };

    const user = await findOrCreateUser();

    // Check if loan query already exists for this user and loan type
    const existingQuery = await LoanQuery.findOne({
      customerId: user._id,
      loanType: loanType,
      status: {
        $nin: ["completed", "completed_success", "approved", "cancelled"],
      },
      ...(primaryAssigneeId ? { assignedAgent: primaryAssigneeId } : {}),
    });

    if (existingQuery) {
      console.log(
        "[CallRecord] Loan query already exists for",
        phoneNumber,
        loanType,
      );
      return existingQuery;
    }

    const firstName =
      String(
        normalizedLoanContext.firstName || callRecord.firstName || "",
      ).trim() || "Unknown";
    const lastName =
      String(
        normalizedLoanContext.lastName || callRecord.lastName || "",
      ).trim() || "Lead";
    const email = String(
      normalizedLoanContext.email || callRecord.email || lead?.email || "",
    )
      .trim()
      .toLowerCase();
    const resolvedLoanAmount = Number(
      normalizedLoanContext.loanAmount ??
        callRecord.loanAmount ??
        lead?.loanAmount ??
        0,
    );
    const resolvedLoanAmountValue = Number.isFinite(resolvedLoanAmount)
      ? resolvedLoanAmount
      : 0;
    const resolvedMobile = String(
      normalizedLoanContext.mobile || phoneNumber || callRecord.phoneNumber,
    ).trim();
    const resolvedCity =
      String(
        normalizedLoanContext.city ||
          callRecord.city ||
          lead?.location?.city ||
          "Unknown",
      ).trim() || "Unknown";
    const resolvedState =
      String(
        normalizedLoanContext.state ||
          callRecord.state ||
          lead?.location?.state ||
          "Unknown",
      ).trim() || "Unknown";
    const resolvedPincode =
      String(
        normalizedLoanContext.pincode ||
          callRecord.pincode ||
          lead?.location?.pincode ||
          "000000",
      ).trim() || "000000";
    const resolvedStreet =
      String(
        normalizedLoanContext.street ||
          normalizedLoanContext.address ||
          callRecord.address ||
          "Not Provided",
      ).trim() || "Not Provided";
    const resolvedEmploymentType =
      String(
        normalizedLoanContext.employmentType ||
          lead?.employmentType ||
          "self_employed",
      )
        .trim()
        .toLowerCase() || "self_employed";
    const resolvedMonthlyIncome = Number(
      normalizedLoanContext.monthlyIncome ??
        callRecord.monthlySalary ??
        lead?.monthlyIncome ??
        0,
    );
    const resolvedCompanyName =
      String(
        normalizedLoanContext.companyName ||
          lead?.companyName ||
          callRecord.dataSource ||
          "Not Provided",
      ).trim() || "Not Provided";
    const resolvedLeadBy =
      String(
        normalizedLoanContext.leadBy || callRecord.leadBy || lead?.leadBy || "",
      ).trim() || "";
    const resolvedDataSource =
      String(
        normalizedLoanContext.dataSource ||
          callRecord.dataSource ||
          lead?.channel ||
          "",
      ).trim() || "";
    const resolvedUpdatedByName =
      String(
        normalizedLoanContext.updatedByName ||
          normalizedLoanContext.actorName ||
          "",
      ).trim() || "";
    const resolvedOfficeAddress =
      String(
        normalizedLoanContext.officeAddress ||
          [resolvedStreet, resolvedCity, resolvedState]
            .filter(Boolean)
            .join(", ") ||
          "Not Provided",
      ).trim() || "Not Provided";
    const resolvedBankName =
      String(normalizedLoanContext.bankName || "Not Provided").trim() ||
      "Not Provided";
    const resolvedAccountType =
      String(normalizedLoanContext.accountType || "savings")
        .trim()
        .toLowerCase() || "savings";
    const resolvedAccountNumber =
      String(normalizedLoanContext.accountNumber || "0000000000").trim() ||
      "0000000000";
    const resolvedIfscCode =
      String(normalizedLoanContext.ifscCode || "NA00000000000")
        .trim()
        .toUpperCase() || "NA00000000000";
    const resolvedDobRaw =
      normalizedLoanContext.dateOfBirth ||
      normalizedLoanContext.dob ||
      lead?.dateOfBirth ||
      "1970-01-01";
    const resolvedDob =
      resolvedDobRaw instanceof Date
        ? resolvedDobRaw
        : new Date(resolvedDobRaw);
    const resolvedGender =
      String(
        normalizedLoanContext.gender ||
          callRecord.gender ||
          Gender.PREFER_NOT_TO_SAY,
      )
        .trim()
        .toLowerCase() || Gender.PREFER_NOT_TO_SAY;
    const resolvedMarriedStatus =
      String(normalizedLoanContext.marriedStatus || "not_specified").trim() ||
      "not_specified";
    const resolvedPan =
      String(normalizedLoanContext.panNumber || callRecord.panNumber || "NA")
        .trim()
        .toUpperCase() || "NA";
    const resolvedAadhaar =
      String(normalizedLoanContext.aadhaarNumber || "NA").trim() || "NA";
    const resolvedLoanType = loanType;

    // Create new loan query
    const loanQueryData: any = {
      customerId: user._id,
      loanType: resolvedLoanType,
      status: "draft",
      ...(toObjectId(context?.actorId || callRecord.createdBy)
        ? {
            createdBy: toObjectId(context?.actorId || callRecord.createdBy),
            updatedBy: toObjectId(context?.actorId || callRecord.createdBy),
          }
        : {}),
      loanAmount: resolvedLoanAmountValue,
      disbursedAmount: Number.isFinite(
        Number(
          normalizedLoanContext.disbursedAmount ?? callRecord.disbursedAmount,
        ),
      )
        ? Number(
            normalizedLoanContext.disbursedAmount ?? callRecord.disbursedAmount,
          )
        : undefined,
      disbursedDate:
        normalizedLoanContext.disbursedDate || callRecord.disbursedDate
          ? new Date(
              normalizedLoanContext.disbursedDate || callRecord.disbursedDate,
            )
          : undefined,
      firstName,
      lastName,
      dateOfBirth: Number.isNaN(resolvedDob.getTime())
        ? new Date("1970-01-01")
        : resolvedDob,
      gender: resolvedGender,
      marriedStatus: resolvedMarriedStatus,
      mobile: resolvedMobile,
      email: email || undefined,
      panNumber: resolvedPan,
      aadhaarNumber: resolvedAadhaar,
      pincode: resolvedPincode,
      state: resolvedState,
      city: resolvedCity,
      street: resolvedStreet,
      leadBy: resolvedLeadBy || undefined,
      dataSource: resolvedDataSource || undefined,
      updatedByName: resolvedUpdatedByName || undefined,
      employmentType: resolvedEmploymentType,
      companyName: resolvedCompanyName,
      monthlyIncome:
        Number.isFinite(resolvedMonthlyIncome) && resolvedMonthlyIncome >= 0
          ? resolvedMonthlyIncome
          : 0,
      officeAddress: resolvedOfficeAddress,
      bankName: resolvedBankName,
      accountType: ["savings", "current", "salary"].includes(
        resolvedAccountType,
      )
        ? resolvedAccountType
        : "savings",
      accountNumber: resolvedAccountNumber,
      ifscCode: resolvedIfscCode,
      bankStatementUrl:
        normalizedLoanContext.bankStatementUrl || callRecord.recordingUrl || "",
      ...(primaryAssigneeId ? { assignedAgent: primaryAssigneeId } : {}),
      ...(Array.isArray(callRecord.assignees) && callRecord.assignees.length > 0
        ? {
            assignedAgents: Array.from(
              new Set(
                callRecord.assignees
                  .map((item) => toObjectId(item))
                  .filter((item): item is Types.ObjectId => Boolean(item))
                  .map((item) => item.toString()),
              ),
            ).map((id) => new Types.ObjectId(id)),
          }
        : {}),
      activities: [
        {
          type: "created",
          description: `Loan query created from Call Record (${requestedProductService || callRecord.productService})`,
          actor: callRecord.createdBy,
          actorModel: "Admin",
          createdAt: new Date(),
        },
      ],
    };

    const newLoanQuery = await LoanQuery.create(loanQueryData);
    if (!newLoanQuery.assignedAgent) {
      await EmployeeAssignmentEngine.ensureAssignmentForLoanQuery(
        newLoanQuery as any,
        {
          actorId: context?.actorId,
          actorModel: "Admin",
          reason: "auto_created_from_call_record",
          session: context?.session,
        },
      );
      await newLoanQuery.save({ session: context?.session });
    }
    console.log(
      "[CallRecord] Created loan query:",
      newLoanQuery._id,
      "for phone:",
      phoneNumber,
    );
    return newLoanQuery;
  } catch (error) {
    console.error("[CallRecord] Error creating loan query:", error);
    return null;
  }
};

const findAutoAssignee = async () => {
  const [assignee] = await Admin.aggregate([
    {
      $lookup: {
        from: "roles",
        localField: "role",
        foreignField: "_id",
        as: "roleData",
      },
    },
    {
      $unwind: "$roleData",
    },
    {
      $match: {
        availability: true,
        leadAutoAssign: { $ne: false },
        "roleData.name": { $regex: /^agent$/i },
      },
    },
    {
      $sort: { activeLeads: 1, lastLeadAssignedAt: 1, createdAt: 1 },
    },
    {
      $limit: 1,
    },
  ]);

  return assignee || null;
};

const notifyAssignee = async (
  req: Request | any,
  record: ICallRecord,
  assigneeId?: string,
) => {
  if (!assigneeId) return;
  try {
    await sendSingleNotification({
      type: "call-record-assigned",
      toUserId: assigneeId,
      toRole: UserType.AGENT,
      fromUser: req?.user?._id
        ? { _id: req.user._id.toString(), role: UserType.ADMIN }
        : undefined,
      context: {
        phone: record.phoneNumber,
        name: `${record.firstName || ""} ${record.lastName || ""}`.trim(),
        product: record.productService || "Call Record",
      },
    });
  } catch (error) {
    console.log("[CallRecord] Failed to notify assignee:", error);
  }
};

const createInsuranceQueryFromCallRecord = async (
  callRecord: ICallRecord,
  context?: Record<string, any>,
  lead?: any,
): Promise<any> => {
  try {
    const phoneNumber = callRecord.phoneNumber;
    if (!phoneNumber) return null;

    const normalizedPhone = phoneNumber.replace(/\D/g, "");
    const searchPhone =
      normalizedPhone.length > 10
        ? normalizedPhone.slice(-10)
        : normalizedPhone;

    const normalizedInsuranceContext = context || {};
    const requestedProductService = String(
      normalizedInsuranceContext.productService ||
        callRecord.productService ||
        "",
    ).trim();
    const insuranceType = normalizeInsuranceTypeFromProductService(
      requestedProductService,
    );
    if (!insuranceType) return null;

    const contextQueryId = String(
      normalizedInsuranceContext.queryId ||
        normalizedInsuranceContext.insuranceQueryId ||
        normalizedInsuranceContext.id ||
        "",
    ).trim();
    if (contextQueryId) {
      const existingById = await InsuranceQuery.findById(contextQueryId);
      if (existingById && existingById.typeOfInsurance === insuranceType) {
        return existingById;
      }
      if (existingById && existingById.typeOfInsurance !== insuranceType) {
        console.log(
          "[CallRecord] Existing insurance context has different type; creating new insurance query",
          {
            existingType: existingById.typeOfInsurance,
            requestedType: insuranceType,
            contextQueryId,
          },
        );
      }
    }

    if (callRecord.insuranceQueryId) {
      const linkedInsuranceQuery = await InsuranceQuery.findById(
        callRecord.insuranceQueryId,
      );
      if (
        linkedInsuranceQuery &&
        linkedInsuranceQuery.typeOfInsurance === insuranceType
      ) {
        return linkedInsuranceQuery;
      }
    }

    const primaryAssigneeId = toObjectId(
      normalizedInsuranceContext.assignee ||
        callRecord.assignee ||
        callRecord.assignees?.[0],
    );

    const existingByContact = await InsuranceQuery.findOne({
      typeOfInsurance: insuranceType,
      status: {
        $nin: [
          InsuranceApplicationStatus.COMPLETED,
          InsuranceApplicationStatus.APPROVED,
          InsuranceApplicationStatus.CANCELLED,
        ],
      },
      ...(primaryAssigneeId ? { assignedAgent: primaryAssigneeId } : {}),
      $or: [
        { mobile: { $regex: searchPhone, $options: "i" } },
        { mobile: phoneNumber },
        ...(normalizedInsuranceContext.email
          ? [
              {
                email: String(normalizedInsuranceContext.email)
                  .trim()
                  .toLowerCase(),
              },
            ]
          : []),
      ],
    });
    if (existingByContact) return existingByContact;

    const findOrCreateUser = async () => {
      if (lead?.borrowerProfile) {
        const borrowerByLead = await User.findById(lead.borrowerProfile);
        if (borrowerByLead) return borrowerByLead;
      }
      if (normalizedInsuranceContext.customerId) {
        const customerId = String(normalizedInsuranceContext.customerId).trim();
        if (customerId) {
          const borrowerByContext = await User.findById(customerId);
          if (borrowerByContext) return borrowerByContext;
        }
      }

      const lookup = [
        { mobile: { $regex: searchPhone, $options: "i" } },
        { mobile: phoneNumber },
      ];
      const existingUser = await User.findOne({ $or: lookup });
      if (existingUser) return existingUser;

      const fallbackName =
        `${callRecord.firstName || lead?.fullName || ""} ${callRecord.lastName || ""}`.trim() ||
        `Lead ${searchPhone.slice(-4) || phoneNumber.slice(-4)}`;

      const createdUser = new User({
        name: fallbackName,
        email: normalizedInsuranceContext.email || undefined,
        mobile: phoneNumber,
        role: "user",
        agreedToTerms: true,
        privacyPolicyAccepted: true,
        gender: Gender.PREFER_NOT_TO_SAY,
        accountSource: AccountSource.ADMIN,
        status: UserStatus.PENDING_VERIFICATION,
      } as any);

      await createdUser.save();
      console.log(
        "[CallRecord] Created fallback borrower profile for insurance phone:",
        phoneNumber,
      );
      return createdUser;
    };

    const user = await findOrCreateUser();

    const existingQuery = await InsuranceQuery.findOne({
      customerId: user._id,
      typeOfInsurance: insuranceType,
      status: {
        $nin: [
          InsuranceApplicationStatus.COMPLETED,
          InsuranceApplicationStatus.APPROVED,
          InsuranceApplicationStatus.CANCELLED,
        ],
      },
      ...(primaryAssigneeId ? { assignedAgent: primaryAssigneeId } : {}),
    });

    if (existingQuery) {
      console.log(
        "[CallRecord] Insurance query already exists for",
        phoneNumber,
        insuranceType,
      );
      return existingQuery;
    }

    const firstName =
      String(
        normalizedInsuranceContext.firstName || callRecord.firstName || "",
      ).trim() || "Unknown";
    const lastName =
      String(
        normalizedInsuranceContext.lastName || callRecord.lastName || "",
      ).trim() || "Lead";
    const email = String(
      normalizedInsuranceContext.email || callRecord.email || lead?.email || "",
    )
      .trim()
      .toLowerCase();
    const resolvedDobRaw =
      normalizedInsuranceContext.dateOfBirth ||
      normalizedInsuranceContext.dob ||
      lead?.dateOfBirth ||
      "1970-01-01";
    const resolvedDob =
      resolvedDobRaw instanceof Date
        ? resolvedDobRaw
        : new Date(resolvedDobRaw);
    const resolvedGender =
      String(
        normalizedInsuranceContext.gender ||
          callRecord.gender ||
          Gender.PREFER_NOT_TO_SAY,
      )
        .trim()
        .toLowerCase() || Gender.PREFER_NOT_TO_SAY;
    const resolvedFullAddress =
      String(
        normalizedInsuranceContext.fullAddress ||
          normalizedInsuranceContext.address ||
          callRecord.address ||
          "Not Provided",
      ).trim() || "Not Provided";
    const resolvedCity =
      String(
        normalizedInsuranceContext.city ||
          callRecord.city ||
          lead?.location?.city ||
          "Unknown",
      ).trim() || "Unknown";
    const resolvedState =
      String(
        normalizedInsuranceContext.state ||
          callRecord.state ||
          lead?.location?.state ||
          "Unknown",
      ).trim() || "Unknown";
    const resolvedPincode =
      String(
        normalizedInsuranceContext.pincode ||
          callRecord.pincode ||
          lead?.location?.pincode ||
          "000000",
      ).trim() || "000000";
    const resolvedOccupation =
      String(normalizedInsuranceContext.occupation || "Not Provided").trim() ||
      "Not Provided";
    const resolvedAnnualIncome = Number(
      normalizedInsuranceContext.annualIncome ??
        (callRecord.monthlySalary ? callRecord.monthlySalary * 12 : null) ??
        normalizedInsuranceContext.loanAmount ??
        callRecord.loanAmount ??
        lead?.loanAmount ??
        0,
    );

    const insuranceQueryData: any = {
      customerId: user._id,
      firstName,
      lastName,
      dateOfBirth: Number.isNaN(resolvedDob.getTime())
        ? new Date("1970-01-01")
        : resolvedDob,
      gender: resolvedGender,
      mobile: normalizedInsuranceContext.mobile || phoneNumber,
      isMobileVerified: false,
      email: email || undefined,
      isEmailVerified: false,
      fullAddress: resolvedFullAddress,
      pincode: resolvedPincode,
      city: resolvedCity,
      state: resolvedState,
      nomineeName:
        String(
          normalizedInsuranceContext.nomineeName ||
            callRecord.lastName ||
            callRecord.firstName ||
            "Not Provided",
        ).trim() || "Not Provided",
      nomineeRelation:
        String(normalizedInsuranceContext.nomineeRelation || "self").trim() ||
        "self",
      occupation: resolvedOccupation,
      annualIncome:
        Number.isFinite(resolvedAnnualIncome) && resolvedAnnualIncome >= 0
          ? resolvedAnnualIncome
          : 0,
      kycDocumentType:
        String(normalizedInsuranceContext.kycDocumentType || "pan").trim() ||
        "pan",
      kycDocumentUrl:
        normalizedInsuranceContext.kycDocumentUrl ||
        normalizedInsuranceContext.kycDocument ||
        "pending_upload",
      typeOfInsurance: insuranceType,
      status: InsuranceApplicationStatus.PENDING,
      policyDetails: {
        ...(normalizedInsuranceContext.policyDetails || {}),
        purpose:
          normalizedInsuranceContext.purpose ||
          requestedProductService ||
          callRecord.productService ||
          "Not Specified",
        requestedCoverage:
          normalizedInsuranceContext.requestedCoverage ??
          normalizedInsuranceContext.loanAmount ??
          callRecord.loanAmount ??
          0,
        ...(insuranceType === "retirement" && callRecord.monthlySalary
          ? {
              currentMonthlyIncome: callRecord.monthlySalary,
            }
          : {}),
      },
      ...(primaryAssigneeId ? { assignedAgent: primaryAssigneeId } : {}),
      activities: [
        {
          type: InsuranceQueryActivityType.CREATED,
          description: `Insurance query created from Call Record (${requestedProductService || callRecord.productService})`,
          actor: callRecord.createdBy,
          actorModel: "Admin",
          payload: {
            phoneNumber,
            insuranceType,
          },
          createdAt: new Date(),
        },
      ],
    };

    const newInsuranceQuery = new InsuranceQuery(insuranceQueryData);

    if (!newInsuranceQuery.assignedAgent) {
      await EmployeeAssignmentEngine.ensureAssignmentForInsuranceQuery(
        newInsuranceQuery as any,
        {
          actorId: context?.actorId,
          actorModel: "Admin",
          reason: "auto_created_from_call_record",
          session: context?.session,
        },
      );
    }

    await newInsuranceQuery.save({ session: context?.session });
    console.log(
      "[CallRecord] Created insurance query:",
      newInsuranceQuery._id,
      "for phone:",
      phoneNumber,
    );
    return newInsuranceQuery;
  } catch (error) {
    console.error("[CallRecord] Error creating insurance query:", error);
    return null;
  }
};

const createInquiryFromCallRecord = async (
  callRecord: ICallRecord,
  context?: Record<string, any>,
  lead?: any,
) => {
  const productService = String(
    context?.productService || callRecord.productService || "",
  ).trim();
  if (!productService) return null;

  const loanType = normalizeLoanType(productService);
  if (loanType) {
    return createLoanQueryFromCallRecord(
      callRecord,
      { ...context, loanType, productService },
      lead,
    );
  }

  const insuranceType =
    normalizeInsuranceTypeFromProductService(productService);
  if (insuranceType) {
    return createInsuranceQueryFromCallRecord(
      callRecord,
      { ...context, typeOfInsurance: insuranceType, productService },
      lead,
    );
  }

  throw new ApiError(
    400,
    `Unsupported product/service "${productService}" for inquiry creation`,
  );
};

const buildCallRecordUserLookup = (record: ICallRecord) => {
  const normalizedMobile = normalizePhoneToLeadFormat(record.phoneNumber);
  const normalizedEmail = String(record.email || "")
    .trim()
    .toLowerCase();
  const digits = normalizePhoneDigits(record.phoneNumber);
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  const mobileCandidates = Array.from(
    new Set(
      [
        normalizedMobile,
        record.phoneNumber,
        digits,
        last10,
        `+91${last10}`,
        `91${last10}`,
        `0${last10}`,
      ].filter(Boolean),
    ),
  );

  return {
    normalizedMobile,
    normalizedEmail,
    mobileCandidates,
  };
};

const findExistingUserForCallRecord = async (record: ICallRecord) => {
  const { normalizedEmail, mobileCandidates } =
    buildCallRecordUserLookup(record);

  const accountFilter: Record<string, any>[] = mobileCandidates.map(
    (mobile) => ({ mobile }),
  );

  if (normalizedEmail) {
    accountFilter.push({ email: normalizedEmail });
  }

  if (accountFilter.length === 0) return null;

  return User.findOne({
    $or: accountFilter,
  });
};

const isDuplicateKeyError = (error: any) => {
  return Boolean(
    error?.code === 11000 ||
    error?.errorResponse?.code === 11000 ||
    error?.keyPattern ||
    error?.errorResponse?.keyPattern,
  );
};

const ensureUserAccountFromCallRecord = async (record: ICallRecord) => {
  const { normalizedMobile, normalizedEmail } =
    buildCallRecordUserLookup(record);

  const existingAccount = await findExistingUserForCallRecord(record);
  if (existingAccount) return existingAccount;

  const accountPayload = {
    name:
      `${record.firstName || ""} ${record.lastName || ""}`.trim() ||
      `Lead ${normalizePhoneDigits(record.phoneNumber).slice(-4)}`,
    mobile: normalizedMobile || record.phoneNumber,
    email: normalizedEmail || undefined,
    role: "user",
    status: UserStatus.PENDING_VERIFICATION,
    accountSource: AccountSource.ADMIN,
    agreedToTerms: true,
    privacyPolicyAccepted: true,
  } as any;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await User.create(accountPayload);
    } catch (error) {
      if (!isDuplicateKeyError(error) || attempt === 1) {
        throw error;
      }

      const retryAccount = await findExistingUserForCallRecord(record);
      if (retryAccount) return retryAccount;
    }
  }

  return null;
};

export class CallRecordController {
  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?._id;
      const payload: any = sanitizeCallRecordPayload({ ...req.body });
      delete payload.commentBy;
      delete payload.commentedAt;

      if (!payload.phoneNumber) {
        return res
          .status(400)
          .json(new ApiError(400, "Phone number is required"));
      }

      const primaryPhoneDigits = normalizePhoneDigits(payload.phoneNumber);
      if (primaryPhoneDigits.length !== 10) {
        return res
          .status(400)
          .json(new ApiError(400, "Phone number must be exactly 10 digits"));
      }
      payload.phoneNumber = primaryPhoneDigits;

      if (payload.alternatePhone) {
        const alternatePhoneDigits = normalizePhoneDigits(
          payload.alternatePhone,
        );
        if (alternatePhoneDigits.length !== 10) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Alternate phone number must be exactly 10 digits",
              ),
            );
        }
        payload.alternatePhone = alternatePhoneDigits;
      }

      const createInquiryEnabled = payload.createInquiry === true;
      let assigneeId = payload.assignee;
      let assignmentMode: "auto" | "manual" = "manual";
      const assignees = normalizeObjectIdArray(
        payload.assignees || payload.assigneeIds,
      );

      if (assignees.length > 0) {
        payload.assignees = assignees;
        assigneeId = assigneeId || assignees[0]?.toString();
      }

      if (createInquiryEnabled) {
        const inquiryProduct = String(payload.productService || "").trim();
        const inquiryLoanAmount = Number(payload.loanAmount);
        const inquiryMonthlySalary = Number(payload.monthlySalary);
        const inquiryPanNumber = String(payload.panNumber || "").trim();
        const inquiryEmploymentType = String(
          payload.employmentType || "",
        )
          .trim()
          .toLowerCase();
        if (!inquiryProduct) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Product/Service is required when inquiry creation is enabled",
              ),
            );
        }
        if (!inquiryEmploymentType) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Income type is required when inquiry creation is enabled",
              ),
            );
        }
        if (!assigneeId) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Assigned agent is required when inquiry creation is enabled",
              ),
            );
        }
        if (!Number.isFinite(inquiryLoanAmount) || inquiryLoanAmount <= 0) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Loan amount is required when inquiry creation is enabled",
              ),
            );
        }
        if (!inquiryPanNumber) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "PAN Card is required when inquiry creation is enabled",
              ),
            );
        }
        if (
          inquiryEmploymentType === "salaried" &&
          (!Number.isFinite(inquiryMonthlySalary) || inquiryMonthlySalary <= 0)
        ) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Monthly income is required for salaried inquiry creation",
              ),
            );
        }
      }

      if (!assigneeId && !createInquiryEnabled) {
        const autoAssignee = await findAutoAssignee();
        if (autoAssignee) {
          assigneeId = autoAssignee._id.toString();
          assignmentMode = "auto";
        }
      }

      if (assigneeId) {
        payload.assignee = assigneeId;
        payload.assignedBy = adminId;
        payload.assignedAt = new Date();
        payload.assignmentMode = assignmentMode;
      }

      if (payload.callbackAt) {
        payload.followUp = true;
      }

      if (adminId) {
        payload.createdBy = adminId;
        payload.updatedBy = adminId;
        if (String(payload.comment || "").trim()) {
          payload.commentBy = adminId;
          payload.commentedAt = new Date();
        }
      }

      const result = await CallRecordService.create(payload);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create call record"));

      if (assigneeId) await notifyAssignee(req, result, assigneeId);
      let finalRecord: any = result;
      let linkedLead: any = null;

      // Auto-attach channel agency + lead when source is provided.
      if (String(result?.dataSource || "").trim()) {
        const linked = await attachLeadToAgencyFromSource(
          result,
          adminId?.toString?.(),
        );
        if (linked?.callRecord) {
          finalRecord = linked.callRecord;
        }
        if (linked?.lead) {
          linkedLead = linked.lead;
        }
      }

      if (payload.createAccount) {
        await ensureUserAccountFromCallRecord(result);
      }

      // Auto-create the inquiry only when the explicit flag is enabled.
      if (payload.createInquiry) {
        const actorDisplayName = await resolveAdminDisplayName(
          adminId?.toString?.(),
        );
        const createdInquiry = await createInquiryFromCallRecord(
          finalRecord || result,
          {
            ...(payload.loanContext || {}),
            actorId: adminId?.toString?.(),
            updatedByName: actorDisplayName || undefined,
            productService: payload.productService || result?.productService,
            assignee: payload.assignee || result?.assignee,
            assignees: payload.assignees || result?.assignees,
          },
          linkedLead,
        );
        if (createdInquiry) {
          const inquiryType = (createdInquiry as any).loanType
            ? "loan"
            : "insurance";
          const updatePayload: Record<string, any> = {
            followUp: true,
          };
          if ((createdInquiry as any).loanType) {
            updatePayload.loanQueryId = createdInquiry._id;
            updatePayload.loanQueryCreatedAt =
              createdInquiry.createdAt || new Date();
          } else if ((createdInquiry as any).typeOfInsurance) {
            updatePayload.insuranceQueryId = createdInquiry._id;
            updatePayload.insuranceQueryCreatedAt =
              createdInquiry.createdAt || new Date();
          }

          finalRecord = await CallRecord.findByIdAndUpdate(
            finalRecord?._id || result._id,
            {
              $set: updatePayload,
            },
            { new: true },
          );
          console.log(
            "[CallRecord] Inquiry ensured during create:",
            inquiryType,
            createdInquiry._id,
          );
        }
      }

      const linkedLoanQueryId =
        payload?.loanContext?.queryId ||
        payload?.loanContext?.loanQueryId ||
        result?.loanQueryId;
      if (linkedLoanQueryId) {
        await CallRecord.findByIdAndUpdate(finalRecord?._id || result._id, {
          $set: {
            loanQueryId: linkedLoanQueryId,
            loanQueryCreatedAt: result?.loanQueryCreatedAt || new Date(),
            followUp: true,
          },
        });
      }

      if (payload.callbackAt || finalRecord?.loanQueryId || linkedLoanQueryId) {
        finalRecord = await CallRecord.findByIdAndUpdate(
          finalRecord?._id || result._id,
          { $set: { followUp: true } },
          { new: true },
        );
      }

      const [enrichedRecord] = await enrichCallRecordsWithCustomerContext([
        normalizeCallRecordAssigneeView(finalRecord),
      ]);

      return res
        .status(201)
        .json(
          new ApiResponse(
            201,
            enrichedRecord || finalRecord,
            "Call record created",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const rawQuery = req.query as Record<string, any>;
      const deferLookupsToDataFacet = shouldDeferCallRecordLookups(rawQuery);

      const lookupStages = [
        {
          $lookup: {
            from: "admins",
            localField: "assignee",
            foreignField: "_id",
            as: "assignee",
          },
        },
        {
          $unwind: {
            path: "$assignee",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "assignees",
            foreignField: "_id",
            as: "assignees",
          },
        },
        {
          $addFields: {
            assigneeCount: {
              $size: {
                $ifNull: ["$assignees", []],
              },
            },
          },
        },
        {
          $lookup: {
            from: "agencies",
            localField: "channelAgency",
            foreignField: "_id",
            as: "channelAgency",
          },
        },
        {
          $unwind: {
            path: "$channelAgency",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "leads",
            localField: "attachedLead",
            foreignField: "_id",
            as: "attachedLead",
          },
        },
        {
          $unwind: {
            path: "$attachedLead",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "assignedBy",
            foreignField: "_id",
            as: "assignedBy",
          },
        },
        {
          $unwind: {
            path: "$assignedBy",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "createdBy",
            foreignField: "_id",
            as: "createdBy",
          },
        },
        {
          $unwind: {
            path: "$createdBy",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "roles",
            localField: "createdBy.role",
            foreignField: "_id",
            as: "createdByRole",
          },
        },
        {
          $unwind: {
            path: "$createdByRole",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "commentBy",
            foreignField: "_id",
            as: "commentBy",
          },
        },
        {
          $unwind: {
            path: "$commentBy",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "updatedBy",
            foreignField: "_id",
            as: "updatedBy",
          },
        },
        {
          $unwind: {
            path: "$updatedBy",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "roles",
            localField: "updatedBy.role",
            foreignField: "_id",
            as: "updatedByRole",
          },
        },
        {
          $unwind: {
            path: "$updatedByRole",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            "createdBy.role": {
              _id: "$createdByRole._id",
              name: "$createdByRole.name",
            },
            "updatedBy.role": {
              _id: "$updatedByRole._id",
              name: "$updatedByRole.name",
            },
          },
        },
      ];

      // Handle callback date range and follow-up bucket filters
      const {
        callbackStart,
        callbackEnd,
        followUpBucket,
        productService,
        loanType,
        includeCustomerContext,
        scope,
        ...queryParams
      } = req.query as Record<string, any>;
      const requestTimeZone = (req as any)?.timezone || DEFAULT_QUERY_TIMEZONE;
      const userId = (req as any)?.user?._id;
      const { role } = (req as any)?.user || {};
      const scopeMatch = buildCallRecordScopeMatch(
        userId,
        role,
        scope === "created" ? "created" : "assigned",
      );

      Object.assign(queryParams, scopeMatch);

      const followUpBucketFilter = getFollowUpBucketFilter(
        followUpBucket,
        requestTimeZone,
      );
      if (followUpBucketFilter) {
        Object.assign(queryParams, followUpBucketFilter);
      }

      // Add callbackAt date range if provided
      if (callbackStart || callbackEnd) {
        const callbackDateFilter: any = {};
        if (callbackStart) {
          const parsedStart = parseDateInTimeZone(
            callbackStart,
            "start",
            requestTimeZone,
          );
          if (parsedStart) callbackDateFilter.$gte = parsedStart;
        }
        if (callbackEnd) {
          const parsedEnd = parseDateInTimeZone(
            callbackEnd,
            "end",
            requestTimeZone,
          );
          if (parsedEnd) callbackDateFilter.$lte = parsedEnd;
        }
        const existingCallbackFilter =
          queryParams.callbackAt && typeof queryParams.callbackAt === "object"
            ? queryParams.callbackAt
            : {};
        queryParams.callbackAt = {
          ...existingCallbackFilter,
          ...callbackDateFilter,
        };
      }

      const loanTypeMatchValues = getLoanTypeMatchValues(
        String(loanType || productService || queryParams.productService || ""),
      );
      const rawAgentFilter = String(queryParams.assignee || "").trim();
      const agentObjectId =
        rawAgentFilter && Types.ObjectId.isValid(rawAgentFilter)
          ? new Types.ObjectId(rawAgentFilter)
          : null;
      delete (queryParams as any).assignee;

      const pipelineModifier =
        loanTypeMatchValues.length > 0 || Boolean(agentObjectId)
          ? (pipeline: any[]) => {
              const next = [...pipeline];
              const dynamicStages: any[] = [];
              if (loanTypeMatchValues.length > 0) {
                dynamicStages.push({
                  $match: {
                    $or: [
                      { productService: { $in: loanTypeMatchValues } },
                      {
                        "attachedLead.productType": {
                          $in: loanTypeMatchValues,
                        },
                      },
                      { "attachedLead.loanType": { $in: loanTypeMatchValues } },
                    ],
                  },
                });
              }
              if (agentObjectId) {
                dynamicStages.push({
                  $match: {
                    $or: [
                      { assignee: agentObjectId },
                      { assignees: agentObjectId },
                    ],
                  },
                });
              }
              const sortIndex = next.findIndex(
                (stage) =>
                  stage && typeof stage === "object" && "$sort" in stage,
              );
              if (sortIndex >= 0) {
                next.splice(sortIndex, 0, ...dynamicStages);
              } else {
                next.push(...dynamicStages);
              }
              return next;
            }
          : undefined;

      const result = await CallRecordService.getAll(queryParams, lookupStages, {
        ...(pipelineModifier ? { pipelineModifier } : {}),
        lookupsInDataFacet: deferLookupsToDataFacet,
      });
      const normalizedResult = Array.isArray(result)
        ? result.map((item) => normalizeCallRecordAssigneeView(item))
        : {
            ...result,
            result: Array.isArray((result as any)?.result)
              ? (result as any).result.map((item: any) =>
                  normalizeCallRecordAssigneeView(item),
                )
              : [],
          };
      const shouldEnrichCustomerContext = shouldIncludeCustomerContext(
        includeCustomerContext,
      );
      const enrichedResult = shouldEnrichCustomerContext
        ? Array.isArray(normalizedResult)
          ? await enrichCallRecordsWithCustomerContext(normalizedResult)
          : {
              ...normalizedResult,
              result: await enrichCallRecordsWithCustomerContext(
                Array.isArray((normalizedResult as any)?.result)
                  ? (normalizedResult as any).result
                  : [],
              ),
            }
        : normalizedResult;
      return res
        .status(200)
        .json(new ApiResponse(200, enrichedResult, "Call records fetched"));
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
      const userId = (req as any)?.user?._id;
      const { role } = (req as any)?.user || {};
      const scope =
        (req.query?.scope as string) === "created" ? "created" : "assigned";
      const match = buildCallRecordScopeMatch(userId, role, scope);
      const requestTimeZone = (req as any)?.timezone || DEFAULT_QUERY_TIMEZONE;
      const followupsFilter = getFollowUpBucketFilter(
        "followups",
        requestTimeZone,
      );
      const todayFilter = getFollowUpBucketFilter("today", requestTimeZone);
      const upcomingFilter = getFollowUpBucketFilter(
        "upcoming",
        requestTimeZone,
      );
      const missedFilter = getFollowUpBucketFilter("missed", requestTimeZone);
      if (
        !followupsFilter ||
        !todayFilter ||
        !upcomingFilter ||
        !missedFilter
      ) {
        throw new ApiError(400, "Invalid follow-up bucket filters");
      }

      const [total, followups, today, upcoming, missed] = await Promise.all([
        CallRecord.countDocuments(match),
        CallRecord.countDocuments({ ...match, ...followupsFilter }),
        CallRecord.countDocuments({ ...match, ...todayFilter }),
        CallRecord.countDocuments({ ...match, ...upcomingFilter }),
        CallRecord.countDocuments({ ...match, ...missedFilter }),
      ]);
      const byType = {
        all: Number(total) || 0,
        followup: Number(followups) || 0,
        followups: Number(followups) || 0,
        today: Number(today) || 0,
        upcoming: Number(upcoming) || 0,
        missed: Number(missed) || 0,
      };
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { total, byType },
            "Call record sidebar counts fetched successfully",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CallRecordService.getById(req.params.id);
      const [enrichedRecord] = await enrichCallRecordsWithCustomerContext([
        normalizeCallRecordAssigneeView(result),
      ]);
      return res
        .status(200)
        .json(
          new ApiResponse(200, enrichedRecord || result, "Call record fetched"),
        );
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request | any, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?._id;
      const record = await CallRecord.findById(req.params.id);
      if (!record)
        return res.status(404).json(new ApiError(404, "Call record not found"));

      const previousAssignee = record.assignee?.toString();
      const incomingAssignee = req.body?.assignee;
      const incomingAssignees = normalizeObjectIdArray(
        req.body?.assignees || req.body?.assigneeIds,
      );
      const rawFollowUpNote = String(
        req.body?.followUpNote ||
          req.body?.followUpClosingRemark ||
          req.body?.followUpRemark ||
          "",
      ).trim();

      const updateBody = sanitizeCallRecordPayload({ ...req.body });
      delete (updateBody as any).followUpNote;
      delete (updateBody as any).followUpClosingRemark;
      delete (updateBody as any).followUpRemark;
      delete (updateBody as any).commentBy;
      delete (updateBody as any).commentedAt;

      const updates: any = {
        ...updateBody,
      };
      if (adminId) updates.updatedBy = adminId;

      if (Object.prototype.hasOwnProperty.call(updateBody, "comment")) {
        const previousComment = String(record.comment || "").trim();
        const nextComment = String(updateBody.comment || "").trim();
        if (
          adminId &&
          nextComment &&
          (nextComment !== previousComment ||
            !record.commentBy ||
            !record.commentedAt)
        ) {
          updates.commentBy = adminId;
          updates.commentedAt = new Date();
        } else if (!nextComment && previousComment) {
          updates.$unset = {
            ...(updates.$unset || {}),
            commentBy: "",
            commentedAt: "",
          };
        }
      }

      if (Object.prototype.hasOwnProperty.call(updateBody, "phoneNumber")) {
        const primaryPhoneDigits = normalizePhoneDigits(updateBody.phoneNumber);
        if (primaryPhoneDigits.length !== 10) {
          return res
            .status(400)
            .json(new ApiError(400, "Phone number must be exactly 10 digits"));
        }
        updates.phoneNumber = primaryPhoneDigits;
      }

      if (Object.prototype.hasOwnProperty.call(updateBody, "alternatePhone")) {
        const alternatePhoneDigits = normalizePhoneDigits(
          updateBody.alternatePhone,
        );
        if (alternatePhoneDigits && alternatePhoneDigits.length !== 10) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Alternate phone number must be exactly 10 digits",
              ),
            );
        }
        updates.alternatePhone = alternatePhoneDigits || "";
      }

      if (incomingAssignees.length > 0) {
        updates.assignees = incomingAssignees;
        updates.assignee = incomingAssignees[0];
      }

      if (updates.callbackAt) {
        updates.followUp = true;
        updates.$unset = {
          ...(updates.$unset || {}),
          callbackNotifiedAt: "",
        };
      }
      if (rawFollowUpNote) {
        updates.followUp = true;
      }

      if (updates.createInquiry === true) {
        const inquiryProduct = String(
          updates.productService || record.productService || "",
        ).trim();
        const inquiryLoanAmount = Number(
          updates.loanAmount ?? record.loanAmount ?? 0,
        );
        const inquiryMonthlySalary = Number(
          updates.monthlySalary ?? record.monthlySalary ?? 0,
        );
        const inquiryPanNumber = String(
          updates.panNumber || record.panNumber || "",
        ).trim();
        const inquiryEmploymentType = String(
          updates.employmentType || record.employmentType || "",
        )
          .trim()
          .toLowerCase();
        const inquiryAssignee =
          updates.assignee || updates.assignees?.[0] || previousAssignee;

        if (!inquiryProduct) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Product/Service is required when inquiry creation is enabled",
              ),
            );
        }
        if (!inquiryAssignee) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Assigned agent is required when inquiry creation is enabled",
              ),
            );
        }
        if (!Number.isFinite(inquiryLoanAmount) || inquiryLoanAmount <= 0) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Loan amount is required when inquiry creation is enabled",
              ),
            );
        }
        if (!inquiryEmploymentType) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Income type is required when inquiry creation is enabled",
              ),
            );
        }
        if (!inquiryPanNumber) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "PAN Card is required when inquiry creation is enabled",
              ),
            );
        }
        if (
          inquiryEmploymentType === "salaried" &&
          (!Number.isFinite(inquiryMonthlySalary) || inquiryMonthlySalary <= 0)
        ) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Monthly income is required for salaried inquiry creation",
              ),
            );
        }
      }

      if (
        (incomingAssignee && incomingAssignee !== previousAssignee) ||
        (incomingAssignees.length > 0 &&
          incomingAssignees[0]?.toString?.() !== previousAssignee)
      ) {
        updates.assignedBy = adminId;
        updates.assignedAt = new Date();
        updates.assignmentMode = "manual";
      }

      const changeKeys = Object.keys(updateBody).filter(
        (key) =>
          ![
            "assignee",
            "assignees",
            "assigneeIds",
            "followUp",
            "callbackAt",
          ].includes(key),
      );
      const changeDiff = buildChangeDiff(
        record.toObject ? record.toObject() : (record as any),
        updateBody,
        changeKeys,
      );
      if (changeDiff.length > 0) {
        updates.$push = {
          ...(updates.$push || {}),
          changeHistory: {
            summary: `Updated ${changeDiff.length} field${changeDiff.length === 1 ? "" : "s"}`,
            diff: changeDiff,
            changedBy: adminId,
            changedAt: new Date(),
          },
        };
      }

      if (rawFollowUpNote) {
        updates.$push = {
          ...(updates.$push || {}),
          followUpNotes: {
            remark: rawFollowUpNote,
            addedBy: adminId,
            addedAt: new Date(),
          },
          followUpHistory: buildFollowUpHistoryEntry(
            record,
            adminId?.toString?.(),
            req.user?.name || req.user?.email || "Admin",
            rawFollowUpNote,
            updates.callbackAt
              ? new Date(updates.callbackAt)
              : record.callbackAt,
          ),
        };
      } else if (updates.callbackAt || updates.followUp) {
        updates.$push = {
          ...(updates.$push || {}),
          followUpHistory: buildFollowUpHistoryEntry(
            record,
            adminId?.toString?.(),
            req.user?.name || req.user?.email || "Admin",
            undefined,
            updates.callbackAt
              ? new Date(updates.callbackAt)
              : record.callbackAt,
          ),
        };
      }

      const result = await CallRecordService.updateById(req.params.id, updates);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update call record"));
      let finalRecord: any = result;
      const linkedLoanQueryIdFromContext =
        req.body?.loanContext?.queryId || req.body?.loanContext?.loanQueryId;

      if (linkedLoanQueryIdFromContext) {
        if (
          !result?.loanQueryId ||
          String(result.loanQueryId) !== String(linkedLoanQueryIdFromContext)
        ) {
          finalRecord = await CallRecord.findByIdAndUpdate(
            req.params.id,
            {
              $set: {
                loanQueryId: linkedLoanQueryIdFromContext,
                loanQueryCreatedAt:
                  result?.loanQueryCreatedAt ||
                  record?.loanQueryCreatedAt ||
                  new Date(),
                followUp: true,
              },
            },
            { new: true },
          );
        }
      }

      console.log("--------------------------");

      // Propagate disbursed fields from CallRecord -> linked LoanQuery
      const shouldPropagateDisbursed =
        Object.prototype.hasOwnProperty.call(updateBody, "disbursedAmount") ||
        Object.prototype.hasOwnProperty.call(updateBody, "disbursedDate");

      if (shouldPropagateDisbursed) {
        const loanQueryId = result?.loanQueryId || record?.loanQueryId;
        if (loanQueryId) {
          const loanQueryUpdatePayload: Record<string, any> = {};
          if (
            Object.prototype.hasOwnProperty.call(updateBody, "disbursedAmount")
          ) {
            if (updates.disbursedAmount !== undefined) {
              loanQueryUpdatePayload.disbursedAmount = updates.disbursedAmount;
            }
          }
          if (
            Object.prototype.hasOwnProperty.call(updateBody, "disbursedDate")
          ) {
            if (updates.disbursedDate !== undefined) {
              loanQueryUpdatePayload.disbursedDate = updates.disbursedDate;
            }
          }

          // Only update fields that were actually sent.
          if (Object.keys(loanQueryUpdatePayload).length > 0) {
            await LoanQuery.findByIdAndUpdate(loanQueryId, {
              $set: loanQueryUpdatePayload,
            });
          }
        }
      }

      if (incomingAssignee && incomingAssignee !== previousAssignee) {
        await notifyAssignee(req, result, incomingAssignee);
      }

      // Auto-create inquiry only when the explicit flag is enabled.
      const incomingProduct = req.body?.productService;
      if (req.body?.createInquiry) {
        const actorDisplayName = await resolveAdminDisplayName(
          adminId?.toString?.(),
        );
        const createdInquiry = await createInquiryFromCallRecord(result, {
          ...(req.body?.loanContext || {}),
          actorId: adminId?.toString?.(),
          updatedByName: actorDisplayName || undefined,
          productService: incomingProduct || result?.productService,
          assignee: req.body?.assignee || result?.assignee,
          assignees: req.body?.assignees || result?.assignees,
        });
        if (createdInquiry) {
          const inquiryType = (createdInquiry as any).loanType
            ? "loan"
            : "insurance";
          const updatePayload: Record<string, any> = {
            followUp: true,
          };
          if ((createdInquiry as any).loanType) {
            updatePayload.loanQueryId = createdInquiry._id;
            updatePayload.loanQueryCreatedAt =
              createdInquiry.createdAt || new Date();

            // If disbursed was updated on the CallRecord in this same request,
            // ensure the newly created LoanQuery reflects it.
            if (
              Object.prototype.hasOwnProperty.call(
                updateBody,
                "disbursedAmount",
              ) ||
              Object.prototype.hasOwnProperty.call(updateBody, "disbursedDate")
            ) {
              const loanQueryUpdatePayload: Record<string, any> = {};
              if (
                Object.prototype.hasOwnProperty.call(
                  updateBody,
                  "disbursedAmount",
                )
              ) {
                loanQueryUpdatePayload.disbursedAmount =
                  updates.disbursedAmount ?? undefined;
              }
              if (
                Object.prototype.hasOwnProperty.call(
                  updateBody,
                  "disbursedDate",
                )
              ) {
                loanQueryUpdatePayload.disbursedDate =
                  updates.disbursedDate ?? undefined;
              }

              await LoanQuery.findByIdAndUpdate(createdInquiry._id, {
                $set: loanQueryUpdatePayload,
              });
            }
          } else if ((createdInquiry as any).typeOfInsurance) {
            updatePayload.insuranceQueryId = createdInquiry._id;
            updatePayload.insuranceQueryCreatedAt =
              createdInquiry.createdAt || new Date();
          }

          await CallRecord.findByIdAndUpdate(req.params.id, {
            $set: updatePayload,
          });
          console.log(
            "[CallRecord] Inquiry created for call record:",
            inquiryType,
            req.params.id,
          );
          finalRecord = await CallRecord.findById(req.params.id);
        }
      }

      if (req.body?.createAccount) {
        await ensureUserAccountFromCallRecord(result);
      }

      // Auto-attach channel agency + lead when source is provided.
      const sourceValue =
        updates?.dataSource !== undefined
          ? updates.dataSource
          : result?.dataSource;
      if (String(sourceValue || "").trim()) {
        const linked = await attachLeadToAgencyFromSource(
          result,
          adminId?.toString?.(),
        );
        if (linked?.callRecord) {
          finalRecord = linked.callRecord;
        }
      } else if (updates?.dataSource !== undefined) {
        finalRecord = await CallRecord.findByIdAndUpdate(
          req.params.id,
          {
            $unset: {
              channelAgency: "",
              attachedLead: "",
              channelMatchedAt: "",
            },
          },
          { new: true },
        );
      }

      const [enrichedRecord] = await enrichCallRecordsWithCustomerContext([
        normalizeCallRecordAssigneeView(finalRecord || result),
      ]);

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            enrichedRecord || finalRecord || result,
            "Call record updated",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      if ((req as any).user?.role !== "admin") {
        return res
          .status(403)
          .json(new ApiError(403, "Only admin can delete call records"));
      }
      const result = await CallRecordService.deleteById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Call record not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Call record deleted"));
    } catch (err) {
      next(err);
    }
  }
}
