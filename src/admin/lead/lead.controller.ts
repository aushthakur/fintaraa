import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import Lead, {
  LeadStatus,
  LeadConnectorType,
  LeadFollowUpStatus,
} from "../../modals/lead.model";
import { CommonService } from "../../services/common.services";
import { leadManagementService } from "../../services/leadManagement.service";
import Agent from "../../modals/agent.model";

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
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      // Build match stage for role-based filtering
      let matchStage: any = {};
      
      // For non-admin users (agents, landers, etc.), only show leads assigned to them
      // Admin role is typically "admin", all other roles should be filtered
      if (role !== "admin" && userId) {
        const userObjectId = new Types.ObjectId(String(userId));
        // Match leads where assignment.current exists and agent matches
        matchStage = {
          "assignment.current": { $exists: true, $ne: null },
          "assignment.current.agent": userObjectId,
        };
        
        // Debug logging
        console.log("🔍 Filtering leads for user:", {
          userId: String(userId),
          role,
          userObjectId: userObjectId.toString(),
          filter: JSON.stringify(matchStage),
        });
      } else {
        console.log("👑 Admin access - showing all leads");
      }

      const pipeline = [
        // Add match stage at the beginning if filtering is needed
        ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
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
      
      // Manually populate the current agent if exists
      if (lead.assignment?.current?.agent) {
        const agent = await Agent.findById(lead.assignment.current.agent)
          .select("name email mobile availability activeLeads leadCapacity profilePictureUrl");
        if (agent) {
          lead.assignment.current.agent = agent as any;
        }
      }

      res
        .status(200)
        .json(new ApiResponse(200, lead, "Lead fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async deleteLead(req: Request, res: Response, next: NextFunction) {
    try {
      const leadId = String(req.params.id || "").trim();
      if (!Types.ObjectId.isValid(leadId)) {
        throw new ApiError(400, "Invalid lead ID");
      }

      const session = (req as any).mongoSession;
      const lead = await Lead.findByIdAndDelete(leadId, { session });
      if (!lead) {
        throw new ApiError(404, "Lead not found");
      }

      const assignedAgentId = lead.assignment?.current?.agent;
      const wasActiveLead = ![
        LeadStatus.CONVERTED,
        LeadStatus.CLOSED,
      ].includes(lead.status);
      if (assignedAgentId && wasActiveLead) {
        await Agent.updateOne(
          { _id: assignedAgentId, activeLeads: { $gt: 0 } },
          { $inc: { activeLeads: -1 } },
          { session },
        );
      }

      return res
        .status(200)
        .json(new ApiResponse(200, { _id: lead._id }, "Lead deleted successfully"));
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
      
      // Check both body and query parameters, and also check for alternative property names
      const status = 
        req.body?.status || 
        req.query?.status || 
        req.body?.Status;
      
      const followUpId = 
        (req.body?.followUpId && String(req.body.followUpId).trim()) || 
        (req.query?.followUpId && String(req.query.followUpId).trim()) ||
        (req.body?.followupId && String(req.body.followupId).trim()) ||
        (req.body?.follow_up_id && String(req.body.follow_up_id).trim()) ||
        (req.body?.id && String(req.body.id).trim()) ||
        (req.query?.id && String(req.query.id).trim());

      const outcome = req.body?.outcome || req.query?.outcome;

      if (!followUpId || !status) {
        // Log the actual request for debugging
        console.log("Request body:", JSON.stringify(req.body, null, 2));
        console.log("Request query:", JSON.stringify(req.query, null, 2));
        console.log("Request params:", JSON.stringify(req.params, null, 2));
        console.log("Content-Type:", req.headers["content-type"]);
        
        throw new ApiError(
          400,
          `followUpId and status are required. Received - followUpId: ${followUpId ? "present" : "missing"}, status: ${status ? "present" : "missing"}. Body keys: ${Object.keys(req.body || {}).join(", ") || "empty"}. Full body: ${JSON.stringify(req.body)}`
        );
      }

      const value = String(status).toLowerCase() as LeadFollowUpStatus;
      if (!Object.values(LeadFollowUpStatus).includes(value)) {
        throw new ApiError(400, `Invalid follow up status: ${value}. Valid values: ${Object.values(LeadFollowUpStatus).join(", ")}`);
      }

      const lead = await leadManagementService.updateFollowUpStatus(
        req.params.id,
        String(followUpId),
        value,
        actorId,
        session,
        outcome ? String(outcome) : undefined
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
      
      console.log("🔄 ============================================");
      console.log("🔄 LEAD CONVERSION FLOW STARTED");
      console.log("🔄 ============================================");
      console.log(`📋 Lead ID: ${req.params.id}`);
      console.log(`👤 Actor ID: ${actorId}`);
      console.log(`📝 Query Data Received:`, req.body.queryData ? 'Yes' : 'No');
      console.log(`🔄 Starting lead conversion process...`);
      
      // Process uploaded files similar to loanquery controller
      const processedQueryData = LeadController.processFileUploads(req);
      
      const { lead, borrower, query } = await leadManagementService.convertLead(
        req.params.id,
        actorId,
        processedQueryData, // Pass the processed query data with file URLs
        session
      );

      let message = "Lead converted successfully";
      if (query) {
        const queryType = (query as any).loanType ? "loan" : "insurance";
        message = `Lead converted successfully and ${queryType} query created`;
        console.log(`✅ SUCCESS: ${message}`);
        console.log(`📊 Query ID: ${query._id}`);
        console.log(`📊 Query Type: ${queryType}`);
      } else {
        console.log(`✅ SUCCESS: Lead converted (no query created)`);
      }
      
      console.log("🔄 ============================================");
      console.log("🔄 LEAD CONVERSION FLOW COMPLETED");
      console.log("🔄 ============================================\n");

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { lead, borrower, query },
            message
          )
        );
    } catch (error) {
      console.error("❌ ============================================");
      console.error("❌ LEAD CONVERSION FLOW FAILED");
      console.error("❌ ============================================");
      console.error(`❌ Error:`, error);
      console.error("❌ ============================================\n");
      next(error);
    }
  }

  // Helper function to extract URL from uploaded file object
  private static extractFileUrl(file: any): string | undefined {
    if (!file) return undefined;
    if (typeof file === "string") return file;
    if (Array.isArray(file) && file.length > 0) {
      return file[0]?.url || file[0];
    }
    return file.url || file;
  }

  // Helper function to process uploaded files and map to queryData
  private static processFileUploads(req: Request): any {
    const queryData = req.body.queryData ? JSON.parse(req.body.queryData) : {};
    
    console.log(`📎 Processing file uploads...`);
    
    // Initialize policyDetails if it doesn't exist
    if (!queryData.policyDetails) {
      queryData.policyDetails = {};
    }

    // Initialize documents if it doesn't exist
    if (!queryData.documents) {
      queryData.documents = {};
    }

    // Process policyDetails document fields (uploaded files/images)
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
    ];

    policyDetailsDocumentFields.forEach((field) => {
      if (req.body[field]) {
        const url = this.extractFileUrl(req.body[field]);
        if (url) {
          queryData.policyDetails[field] = url;
          console.log(`  ✅ Uploaded ${field}: ${url}`);
        }
      }
    });

    // Process bankStatementUrl (main field for loans)
    if (req.body.bankStatementUrl) {
      const url = this.extractFileUrl(req.body.bankStatementUrl);
      if (url) {
        queryData.bankStatementUrl = url;
        console.log(`  ✅ Uploaded bankStatementUrl: ${url}`);
      }
    }

    // Process documents field - these are uploaded as separate fields and mapped to documents object
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
        const url = this.extractFileUrl(req.body[docType]);
        if (url) {
          queryData.documents[docType] = url;
          console.log(`  ✅ Uploaded document ${docType}: ${url}`);
        }
      }
    });

    // Process kycDocument for insurance (maps to kycDocumentUrl)
    if (req.body.kycDocument) {
      const url = this.extractFileUrl(req.body.kycDocument);
      if (url) {
        queryData.kycDocumentUrl = url;
        console.log(`  ✅ Uploaded kycDocument: ${url}`);
      }
    }

    // Process insurance-specific documents in policyDetails
    const insuranceDocFields = [
      "medicalReports",
      "drivingLicense",
      "rcBook",
      "propertyDocuments",
      "stockValuationReport",
      "purchaseInvoice",
      "maintenanceRecord",
      "medicalReport",
      "shopLicense",
      "gstCertificate",
    ];

    insuranceDocFields.forEach((field) => {
      if (req.body[field]) {
        const url = this.extractFileUrl(req.body[field]);
        if (url) {
          queryData.policyDetails[field] = url;
          console.log(`  ✅ Uploaded insurance document ${field}: ${url}`);
        }
      }
    });

    console.log(`📎 File processing complete`);
    return queryData;
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
