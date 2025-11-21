import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import Lead, {
  LeadStatus,
  LeadConnectorType,
  LeadFollowUpStatus,
} from "../../modals/lead.model";
import { CommonService } from "../../services/common.services";
import { leadManagementService } from "../../services/leadManagement.service";

const leadService = new CommonService(Lead);

const normalizeSource = (source: string): LeadConnectorType => {
  const normalized = source?.toLowerCase() as LeadConnectorType;
  const allowed = Object.values(LeadConnectorType);
  if (!allowed.includes(normalized)) {
    throw new ApiError(400, "Unsupported integration source");
  }
  return normalized;
};

export class LeadController {
  static async ingestFromConnector(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const source = normalizeSource(req.params.source);
      const session = (req as any).mongoSession;
      const { lead } = await leadManagementService.captureLead(req.body, {
        source,
        channel: req.query.channel?.toString(),
        metadata: { headers: req.headers, query: req.query },
        session,
        externalId: (
          req.body?.lead_id ||
          req.body?.leadId ||
          req.body?.id ||
          req.query?.id
        )?.toString(),
      });

      res
        .status(201)
        .json(new ApiResponse(201, { id: lead._id }, "Lead ingested"));
    } catch (error) {
      next(error);
    }
  }

  static async createLead(req: Request, res: Response, next: NextFunction) {
    try {
      const session = (req as any).mongoSession;
      const actorId = (req as any).user?._id;
      const { lead } = await leadManagementService.captureLead(req.body, {
        source: LeadConnectorType.MANUAL,
        channel: "crm",
        actorId,
        session,
        metadata: { createdBy: actorId },
      });

      res
        .status(201)
        .json(new ApiResponse(201, lead, "Lead created successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getLeads(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "agents",
            localField: "assignment.current.agent",
            foreignField: "_id",
            as: "agentData",
          },
        },
        {
          $unwind: {
            path: "$agentData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "borrowerProfile",
            foreignField: "_id",
            as: "borrower",
          },
        },
        {
          $unwind: {
            path: "$borrower",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            fullName: 1,
            email: 1,
            mobile: 1,
            status: 1,
            priority: 1,
            loanAmount: 1,
            loanPurpose: 1,
            intentScore: 1,
            productType: 1,
            tags: 1,
            location: 1,
            capturedFrom: 1,
            createdAt: 1,
            nextActionAt: 1,
            lastContactedAt: 1,
            agent: {
              _id: "$agentData._id",
              name: "$agentData.name",
              email: "$agentData.email",
            },
            borrower: {
              _id: "$borrower._id",
              name: "$borrower.name",
              email: "$borrower.email",
            },
          },
        },
      ];

      const result = await leadService.getAll(req.query, pipeline);
      res
        .status(200)
        .json(new ApiResponse(200, result, "Leads fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getLead(req: Request, res: Response, next: NextFunction) {
    try {
      const lead = await leadService.getById(req.params.id, true);
      res
        .status(200)
        .json(new ApiResponse(200, lead, "Lead fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async addNote(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const lead = await leadManagementService.addNote(
        req.params.id,
        req.body,
        { id: actorId, model: "Admin" },
        session
      );

      res
        .status(200)
        .json(new ApiResponse(200, lead, "Note added successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async addFollowUp(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const lead = await leadManagementService.addFollowUp(
        req.params.id,
        req.body,
        actorId,
        session
      );

      res.status(200).json(new ApiResponse(200, lead, "Follow-up scheduled"));
    } catch (error) {
      next(error);
    }
  }

  static async updateFollowUpStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const { status, followUpId, outcome } = req.body;

      if (!followUpId || !status) {
        throw new ApiError(400, "followUpId and status are required");
      }

      const value = status.toLowerCase() as LeadFollowUpStatus;
      if (!Object.values(LeadFollowUpStatus).includes(value)) {
        throw new ApiError(400, "Invalid follow up status");
      }

      const lead = await leadManagementService.updateFollowUpStatus(
        req.params.id,
        followUpId,
        value,
        actorId,
        session,
        outcome
      );

      res.status(200).json(new ApiResponse(200, lead, "Follow-up updated"));
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, reason } = req.body;
      if (!status) throw new ApiError(400, "Status is required");
      const normalized = status.toLowerCase() as LeadStatus;
      if (!Object.values(LeadStatus).includes(normalized)) {
        throw new ApiError(400, "Invalid status value");
      }

      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const lead = await leadManagementService.updateStatus(
        req.params.id,
        normalized,
        actorId,
        session,
        { reason }
      );

      res.status(200).json(new ApiResponse(200, lead, "Lead status updated"));
    } catch (error) {
      next(error);
    }
  }

  static async reassign(req: Request, res: Response, next: NextFunction) {
    try {
      const { agentId, reason } = req.body;
      if (!agentId) throw new ApiError(400, "agentId is required");
      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const lead = await leadManagementService.reassignLead(
        req.params.id,
        agentId,
        { actorId, reason, session, mode: "manual" }
      );

      res.status(200).json(new ApiResponse(200, lead, "Lead reassigned"));
    } catch (error) {
      next(error);
    }
  }

  static async escalate(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const lead = await leadManagementService.escalateLead(
        req.params.id,
        req.body,
        actorId,
        session
      );

      res.status(200).json(new ApiResponse(200, lead, "Lead escalated"));
    } catch (error) {
      next(error);
    }
  }

  static async convert(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const session = (req as any).mongoSession;
      const { lead, borrower } = await leadManagementService.convertLead(
        req.params.id,
        actorId,
        session
      );

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { lead, borrower },
            "Lead converted successfully"
          )
        );
    } catch (error) {
      next(error);
    }
  }

  static async pipelineSummary(
    _req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const [summary, overdue] = await Promise.all([
        Lead.aggregate([
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]),
        Lead.countDocuments({
          status: {
            $in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.IN_PROGRESS],
          },
          nextActionAt: { $lt: new Date() },
        }),
      ]);

      const formatted = summary.reduce(
        (acc, entry) => ({ ...acc, [entry._id]: entry.count }),
        {} as Record<string, number>
      );

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { summary: formatted, overdue },
            "Pipeline summary"
          )
        );
    } catch (error) {
      next(error);
    }
  }
}
