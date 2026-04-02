import { Request, Response, NextFunction } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { CallRecord, ICallRecord } from "../../modals/callRecord.model";
import Agent from "../../modals/agent.model";
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
): Record<string, any> | null => {
  const bucket = String(bucketRaw || "")
    .trim()
    .toLowerCase();
  if (!bucket) return null;

  const now = new Date();
  const todayKey = formatDateInTimeZone(now, DEFAULT_QUERY_TIMEZONE);
  const startOfToday = parseDateInTimeZone(
    todayKey,
    "start",
    DEFAULT_QUERY_TIMEZONE,
  );
  const endOfToday = parseDateInTimeZone(
    todayKey,
    "end",
    DEFAULT_QUERY_TIMEZONE,
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

      const fallbackEmail = `${searchPhone || normalizePhoneDigits(phoneNumber)}@lead.auto`;
      const fallbackName =
        `${callRecord.firstName || lead?.fullName || ""} ${callRecord.lastName || ""}`.trim() ||
        `Lead ${searchPhone.slice(-4) || phoneNumber.slice(-4)}`;

      const createdUser = new User({
        name: fallbackName,
        email: fallbackEmail,
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
    const email =
      String(
        normalizedLoanContext.email ||
          callRecord.email ||
          lead?.email ||
          `${searchPhone || normalizePhoneDigits(phoneNumber)}@lead.auto`,
      )
        .trim()
        .toLowerCase() || `${searchPhone || normalizePhoneDigits(phoneNumber)}@lead.auto`;
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
      email,
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
  return Agent.findOne({
    availability: true,
    leadAutoAssign: { $ne: false },
  }).sort({ activeLeads: 1, lastLeadAssignedAt: 1, createdAt: 1 });
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

      if (!assigneeId) {
        const agent = await findAutoAssignee();
        if (agent) {
          assigneeId = agent._id.toString();
          assignmentMode = "auto";
        }
      }

      if (assigneeId) {
        payload.assignee = assigneeId;
        payload.assignedBy = adminId;
        payload.assignedAt = new Date();
        payload.assignmentMode = assignmentMode;
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

      // Auto-create a loan application for loan products so it appears in the loan section immediately.
      if (result?.productService && isLoanProduct(result.productService)) {
        const loanQuery = await createLoanQueryFromCallRecord(
          finalRecord || result,
          payload.loanContext,
          linkedLead,
        );
        if (loanQuery) {
          console.log(
            "[CallRecord] Loan query ensured during create:",
            loanQuery._id,
          );
        }
      }

      return res
        .status(201)
        .json(new ApiResponse(201, finalRecord, "Call record created"));
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const lookupStages = [
        {
          $lookup: {
            from: "agents",
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

      const followUpBucketFilter = getFollowUpBucketFilter(followUpBucket);
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
            DEFAULT_QUERY_TIMEZONE,
          );
          if (parsedStart) callbackDateFilter.$gte = parsedStart;
        }
        if (callbackEnd) {
          const parsedEnd = parseDateInTimeZone(
            callbackEnd,
            "end",
            DEFAULT_QUERY_TIMEZONE,
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
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Call records fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CallRecordService.getById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Call record fetched"));
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

      const updates: any = {
        ...req.body,
      };
      if (adminId) updates.updatedBy = adminId;

      if (incomingAssignee && incomingAssignee !== previousAssignee) {
        updates.assignedBy = adminId;
        updates.assignedAt = new Date();
        updates.assignmentMode = "manual";
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

      return res
        .status(200)
        .json(new ApiResponse(200, finalRecord || result, "Call record updated"));
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
