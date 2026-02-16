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

const CallRecordService = new CommonService<ICallRecord>(CallRecord as any);

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

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Call record created"));
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

      // Handle callback date range filters
      const { callbackStart, callbackEnd, ...queryParams } = req.query;

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
        queryParams.callbackAt = callbackDateFilter;
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

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Call record updated"));
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
