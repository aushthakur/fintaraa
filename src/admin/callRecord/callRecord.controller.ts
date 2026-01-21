import { Request, Response, NextFunction } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import { CallRecord, ICallRecord } from "../../modals/callRecord.model";
import Agent from "../../modals/agent.model";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";

const CallRecordService = new CommonService<ICallRecord>(CallRecord as any);

const findAutoAssignee = async () => {
  return Agent.findOne({
    availability: true,
    leadAutoAssign: { $ne: false },
  }).sort({ activeLeads: 1, lastLeadAssignedAt: 1, createdAt: 1 });
};

const notifyAssignee = async (
  req: Request | any,
  record: ICallRecord,
  assigneeId?: string
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
      const result = await CallRecordService.getAll(req.query, lookupStages);
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
        return res
          .status(404)
          .json(new ApiError(404, "Call record not found"));

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

      const result = await CallRecordService.updateById(
        req.params.id,
        updates
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update call record"));

      if (incomingAssignee && incomingAssignee !== previousAssignee) {
        await notifyAssignee(req, result, incomingAssignee);
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
        return res
          .status(404)
          .json(new ApiError(404, "Call record not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Call record deleted"));
    } catch (err) {
      next(err);
    }
  }
}
