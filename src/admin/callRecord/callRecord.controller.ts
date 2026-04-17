import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { CallRecord, ICallRecord } from "../../modals/callRecord.model";
import Admin from "../../modals/admin.model";
import Ticket from "../../modals/ticket.model";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";
import { Gender, User, UserStatus } from "../../modals/user.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { Agency } from "../../modals/agency.model";
import Lead, { LeadConnectorType } from "../../modals/lead.model";
import { leadManagementService } from "../../services/leadManagement.service";
import { getLoanTypeMatchValues, normalizeLoanType } from "../../utils/loanType";
import {
  DEFAULT_QUERY_TIMEZONE,
  formatDateInTimeZone,
  parseDateInTimeZone,
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

const buildCallRecordScopeMatch = (userId: any, role?: string) => {
  const match: Record<string, any> = {};
  if (role === "admin") return match;

  const objectId = toObjectId(userId);
  if (!objectId) return { _id: null };

  if (role === "agent") {
    match.$or = [{ assignee: objectId }, { assignees: objectId }];
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
  const openingRemark = String(record.comment || record.contactActionStatus || "")
    .trim();

  return {
    openedBy: record.createdBy || (actorId ? new Types.ObjectId(actorId) : undefined),
    closedBy: actorId ? new Types.ObjectId(actorId) : undefined,
    openedByName: (record as any)?.createdBy?.name || actorName || undefined,
    closedByName: actorName,
    openedAt: record.createdAt || now,
    closedAt: now,
    openingRemark: openingRemark || undefined,
    closingRemark: closingRemark || undefined,
    assignedTo: record.assignee || undefined,
    assignedToName: (record as any)?.assignee?.name || (record as any)?.assigneeName || undefined,
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
      ? record.assignees.filter((agent: any) => agent && typeof agent === "object")
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
    const candidates = recordCandidates.get(recordId) || buildPhoneCandidates(record?.phoneNumber);
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
            sourceLabel: matchedUser.isMobileVerified !== false
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

  const now = new Date();
  const todayKey = formatDateInTimeZone(now, timeZone);
  const startOfToday = parseDateInTimeZone(
    todayKey,
    "start",
    timeZone,
  );
  const endOfToday = parseDateInTimeZone(
    todayKey,
    "end",
    timeZone,
  );

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

// Check if product is a loan type
const isLoanProduct = (productService?: string): boolean => {
  return !!normalizeLoanType(productService);
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

    const loanType = normalizeLoanType(callRecord.productService);
    if (!loanType) return null;

    const normalizedLoanContext = context || {};
    const contextQueryId = String(
      normalizedLoanContext.queryId ||
        normalizedLoanContext.loanQueryId ||
        normalizedLoanContext.id ||
        "",
    ).trim();
    if (contextQueryId) {
      const existingById = await LoanQuery.findById(contextQueryId);
      if (existingById) return existingById;
    }

    const existingByContact = await LoanQuery.findOne({
      loanType,
      status: { $nin: ["completed", "approved", "cancelled"] },
      $or: [
        { mobile: { $regex: searchPhone, $options: "i" } },
        { mobile: phoneNumber },
        ...(normalizedLoanContext.email
          ? [{ email: String(normalizedLoanContext.email).trim().toLowerCase() }]
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
        status: UserStatus.PENDING_VERIFICATION,
      } as any);

      await createdUser.save();
      console.log("[CallRecord] Created fallback borrower profile for phone:", phoneNumber);
      return createdUser;
    };

    const user = await findOrCreateUser();

    // Check if loan query already exists for this user and loan type
    const existingQuery = await LoanQuery.findOne({
      customerId: user._id,
      loanType: loanType,
      status: { $nin: ["completed", "approved", "cancelled"] },
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
      String(normalizedLoanContext.firstName || callRecord.firstName || "")
        .trim() || "Unknown";
    const lastName =
      String(normalizedLoanContext.lastName || callRecord.lastName || "")
        .trim() || "Lead";
    const email = String(
      normalizedLoanContext.email || callRecord.email || lead?.email || "",
    )
      .trim()
      .toLowerCase();
    const resolvedLoanAmount = Number(
      normalizedLoanContext.loanAmount ?? callRecord.loanAmount ?? lead?.loanAmount ?? 0,
    );
    const resolvedLoanAmountValue = Number.isFinite(resolvedLoanAmount)
      ? resolvedLoanAmount
      : 0;
    const resolvedMobile = String(
      normalizedLoanContext.mobile || phoneNumber || callRecord.phoneNumber,
    ).trim();
    const resolvedCity =
      String(normalizedLoanContext.city || callRecord.city || lead?.location?.city || "Unknown")
        .trim() || "Unknown";
    const resolvedState =
      String(normalizedLoanContext.state || callRecord.state || lead?.location?.state || "Unknown")
        .trim() || "Unknown";
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
      normalizedLoanContext.monthlyIncome ?? lead?.monthlyIncome ?? resolvedLoanAmountValue,
    );
    const resolvedCompanyName =
      String(
        normalizedLoanContext.companyName ||
          lead?.companyName ||
          callRecord.dataSource ||
          "Not Provided",
      ).trim() || "Not Provided";
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
      String(normalizedLoanContext.ifscCode || "NA00000000000").trim().toUpperCase() ||
      "NA00000000000";
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
      String(normalizedLoanContext.gender || callRecord.gender || Gender.PREFER_NOT_TO_SAY)
        .trim()
        .toLowerCase() || Gender.PREFER_NOT_TO_SAY;
    const resolvedMarriedStatus =
      String(normalizedLoanContext.marriedStatus || "not_specified")
        .trim() || "not_specified";
    const resolvedPan =
      String(normalizedLoanContext.panNumber || "NA").trim().toUpperCase() ||
      "NA";
    const resolvedAadhaar =
      String(normalizedLoanContext.aadhaarNumber || "NA").trim() || "NA";
    const resolvedLoanType = loanType;

    // Create new loan query
    const loanQueryData: any = {
      customerId: user._id,
      loanType: resolvedLoanType,
      status: "draft",
      loanAmount: resolvedLoanAmountValue,
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
      employmentType: resolvedEmploymentType,
      companyName: resolvedCompanyName,
      monthlyIncome:
        Number.isFinite(resolvedMonthlyIncome) && resolvedMonthlyIncome >= 0
          ? resolvedMonthlyIncome
          : 0,
      officeAddress: resolvedOfficeAddress,
      bankName: resolvedBankName,
      accountType:
        ["savings", "current", "salary"].includes(resolvedAccountType)
          ? resolvedAccountType
          : "savings",
      accountNumber: resolvedAccountNumber,
      ifscCode: resolvedIfscCode,
      bankStatementUrl:
        normalizedLoanContext.bankStatementUrl || callRecord.recordingUrl || "",
      activities: [
        {
          type: "created",
          description: `Loan query created from Call Record (${callRecord.productService})`,
          actor: callRecord.createdBy,
          actorModel: "Admin",
          createdAt: new Date(),
        },
      ],
    };

    const newLoanQuery = await LoanQuery.create(loanQueryData);
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

const ensureUserAccountFromCallRecord = async (record: ICallRecord) => {
  const normalizedMobile = normalizePhoneToLeadFormat(record.phoneNumber);
  const normalizedEmail = String(record.email || "").trim().toLowerCase();
  const accountFilter: Record<string, any>[] = [];
  if (normalizedMobile) {
    accountFilter.push({ mobile: normalizedMobile });
    accountFilter.push({ mobile: record.phoneNumber });
  }
  if (normalizedEmail) {
    accountFilter.push({ email: normalizedEmail });
  }

  const existingAccount = await User.findOne({
    $or: accountFilter,
  });
  if (existingAccount) return existingAccount;

  return User.create({
    name:
      `${record.firstName || ""} ${record.lastName || ""}`.trim() ||
      `Lead ${normalizePhoneDigits(record.phoneNumber).slice(-4)}`,
    mobile: normalizedMobile || record.phoneNumber,
    email: normalizedEmail || undefined,
    role: "user",
    status: UserStatus.PENDING_VERIFICATION,
    agreedToTerms: true,
    privacyPolicyAccepted: true,
  } as any);
};

export class CallRecordController {
  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?._id;
      const payload: any = { ...req.body };

      if (!payload.phoneNumber) {
        return res
          .status(400)
          .json(new ApiError(400, "Phone number is required"));
      }

      let assigneeId = payload.assignee;
      let assignmentMode: "auto" | "manual" = "manual";
      const assignees = normalizeObjectIdArray(
        payload.assignees || payload.assigneeIds,
      );

      if (assignees.length > 0) {
        payload.assignees = assignees;
        assigneeId = assigneeId || assignees[0]?.toString();
      }

      if (!assigneeId) {
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

      // Auto-create a loan application for loan products so it appears in the loan section immediately.
      if (result?.productService && isLoanProduct(result.productService)) {
        const loanQuery = await createLoanQueryFromCallRecord(
          finalRecord || result,
          payload.loanContext,
          linkedLead,
        );
        if (loanQuery) {
          await CallRecord.findByIdAndUpdate(
            finalRecord?._id || result._id,
            {
              $set: {
                loanQueryId: loanQuery._id,
                loanQueryCreatedAt: loanQuery.createdAt || new Date(),
                followUp: true,
              },
            },
          );
          console.log(
            "[CallRecord] Loan query ensured during create:",
            loanQuery._id,
          );
        }
      }

      if (payload.callbackAt || finalRecord?.loanQueryId) {
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
      ];

      // Handle callback date range and follow-up bucket filters
      const {
        callbackStart,
        callbackEnd,
        followUpBucket,
        productService,
        loanType,
        ...queryParams
      } = req.query as Record<string, any>;
      const requestTimeZone =
        (req as any)?.timezone || DEFAULT_QUERY_TIMEZONE;

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

      const pipelineModifier =
        loanTypeMatchValues.length > 0
          ? (pipeline: any[]) => {
              const next = [...pipeline];
              const matchStage = {
                $match: {
                  $or: [
                    { productService: { $in: loanTypeMatchValues } },
                    { "attachedLead.productType": { $in: loanTypeMatchValues } },
                    { "attachedLead.loanType": { $in: loanTypeMatchValues } },
                  ],
                },
              };
              const sortIndex = next.findIndex(
                (stage) => stage && typeof stage === "object" && "$sort" in stage,
              );
              if (sortIndex >= 0) {
                next.splice(sortIndex, 0, matchStage);
              } else {
                next.push(matchStage);
              }
              return next;
            }
          : undefined;

      const result = await CallRecordService.getAll(
        queryParams,
        lookupStages,
        pipelineModifier ? { pipelineModifier } : undefined,
      );
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
      const enrichedResult = Array.isArray(normalizedResult)
        ? await enrichCallRecordsWithCustomerContext(normalizedResult)
        : {
            ...normalizedResult,
            result: await enrichCallRecordsWithCustomerContext(
              Array.isArray((normalizedResult as any)?.result)
                ? (normalizedResult as any).result
                : [],
            ),
          };
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
      const match = buildCallRecordScopeMatch(userId, role);
      const total = await CallRecord.countDocuments(match);
      return res.status(200).json(
        new ApiResponse(
          200,
          { total },
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
          new ApiResponse(
            200,
            enrichedRecord || result,
            "Call record fetched",
          ),
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

      const updateBody = { ...req.body };
      delete (updateBody as any).followUpNote;
      delete (updateBody as any).followUpClosingRemark;
      delete (updateBody as any).followUpRemark;

      const updates: any = {
        ...updateBody,
      };
      if (adminId) updates.updatedBy = adminId;

      if (incomingAssignees.length > 0) {
        updates.assignees = incomingAssignees;
        updates.assignee = incomingAssignees[0];
      }

      if (updates.callbackAt) {
        updates.followUp = true;
      }
      if (rawFollowUpNote) {
        updates.followUp = true;
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
          !["assignee", "assignees", "assigneeIds", "followUp", "callbackAt"].includes(key),
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
            updates.callbackAt ? new Date(updates.callbackAt) : record.callbackAt,
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
            updates.callbackAt ? new Date(updates.callbackAt) : record.callbackAt,
          ),
        };
      }

      const result = await CallRecordService.updateById(req.params.id, updates);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update call record"));
      let finalRecord: any = result;

      if (incomingAssignee && incomingAssignee !== previousAssignee) {
        await notifyAssignee(req, result, incomingAssignee);
      }

      // Auto-create loan query if product is a loan type
      const incomingProduct = req.body?.productService;
      if (incomingProduct && isLoanProduct(incomingProduct)) {
        const loanQuery = await createLoanQueryFromCallRecord(result);
        if (loanQuery) {
          console.log(
            "[CallRecord] Loan query created for call record:",
            req.params.id,
          );
        }
      }

      if (req.body?.createAccount) {
        await ensureUserAccountFromCallRecord(result);
      }

      // Auto-attach channel agency + lead when source is provided.
      const sourceValue =
        updates?.dataSource !== undefined ? updates.dataSource : result?.dataSource;
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
