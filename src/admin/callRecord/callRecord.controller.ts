import { Request, Response, NextFunction } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { CallRecord, ICallRecord } from "../../modals/callRecord.model";
import Agent from "../../modals/agent.model";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";
import { User } from "../../modals/user.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { Agency } from "../../modals/agency.model";
import Lead, { LeadConnectorType } from "../../modals/lead.model";
import { leadManagementService } from "../../services/leadManagement.service";

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
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

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

// Map productService values to loan types
const loanProductToLoanType: Record<string, string> = {
  personal_loan: "personal_loan",
  instant_loan: "instant_loan",
  home_loan: "home_loan",
  business_loan: "business_loan",
  vehicle_loan: "vehicle_loan",
  two_wheeler_loan: "two_wheeler_loan",
  used_car_loan: "used_car_loan",
  education_loan: "education_loan",
  agriculture_loan: "agriculture_loan",
  gold_loan: "gold_loan",
  renovation_loan: "renovation_loan",
  loan_against_property: "loan_against_property",
  loan_against_security: "loan_against_security",
  working_capital_loan: "working_capital_loan",
  top_up_loan: "top_up_loan",
  balance_transfer_loan: "balance_transfer_loan",
  loan_against_car: "loan_against_car",
};

// Check if product is a loan type
const isLoanProduct = (productService: string): boolean => {
  return !!loanProductToLoanType[productService];
};

// Create loan query from call record data
const createLoanQueryFromCallRecord = async (
  callRecord: ICallRecord,
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

    // Find user by mobile
    const user = await User.findOne({
      mobile: { $regex: searchPhone, $options: "i" },
    });
    if (!user) {
      console.log("[CallRecord] No user found for phone:", phoneNumber);
      return null;
    }

    const loanType = loanProductToLoanType[callRecord.productService as any];
    if (!loanType) return null;

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

    // Create new loan query
    const loanQueryData: any = {
      customerId: user._id,
      loanType: loanType,
      status: "draft",
      loanAmount: callRecord.loanAmount,
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

      // Auto-attach channel agency + lead when source is provided.
      if (String(result?.dataSource || "").trim()) {
        const linked = await attachLeadToAgencyFromSource(
          result,
          adminId?.toString?.(),
        );
        if (linked?.callRecord) {
          finalRecord = linked.callRecord;
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
      const { callbackStart, callbackEnd, followUpBucket, ...queryParams } =
        req.query as Record<string, any>;

      const followUpBucketFilter = getFollowUpBucketFilter(followUpBucket);
      if (followUpBucketFilter) {
        Object.assign(queryParams, followUpBucketFilter);
      }

      // Add callbackAt date range if provided
      if (callbackStart || callbackEnd) {
        const callbackDateFilter: any = {};
        if (callbackStart) {
          callbackDateFilter.$gte = new Date(callbackStart as string);
        }
        if (callbackEnd) {
          // Set end date to end of day
          const endDate = new Date(callbackEnd as string);
          endDate.setHours(23, 59, 59, 999);
          callbackDateFilter.$lte = endDate;
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

      const result = await CallRecordService.getAll(queryParams, lookupStages);
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
