import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  LoanQuery,
  allowedFieldsByFormType,
  LoanQueryActivityType,
} from "../../modals/loanquery.model";
import { ApplicationStatus } from "../../modals/insurancequery.model";
import LanderAssignmentEngine from "../../services/landerAssignment.service";
import { Types } from "mongoose";
import Lander from "../../modals/lander.model";
import {
  fetchSurepassRcDetails,
  prepareSurepassRcPayload,
} from "../../services/surepass.service";

const loanQueryService = new CommonService(LoanQuery);

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
    return file
      .map((item) => item?.url || item)
      .filter(Boolean);
  }
  if (file.url) return [file.url];
  return [];
};

// Helper function to process uploaded files and map to request body
const processFileUploads = (req: Request) => {
  // Initialize policyDetails if it doesn't exist
  if (!req.body.policyDetails) {
    req.body.policyDetails = {};
  }

  // Initialize documents if it doesn't exist
  if (!req.body.documents) {
    req.body.documents = {};
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
  if (["saving", "savings", "savingaccount", "savingsaccount"].includes(compact))
    return "savings";
  if (["current", "currentaccount"].includes(compact)) return "current";
  if (["salary", "salaryaccount"].includes(compact)) return "salary";
  return normalized;
};

export class LoanQueryController {
  static async fetchRcDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = prepareSurepassRcPayload(req.body || {});
      const result = await fetchSurepassRcDetails(payload);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "RC details fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createQuery(req: Request, res: Response, next: NextFunction) {
    try {
      // Get customer ID from authenticated user token
      const customerId = (req as any).user?._id;
      if (!customerId) {
        return res
          .status(401)
          .json(new ApiError(401, "User authentication required"));
      }

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Automatically set customerId from token
      req.body.customerId = customerId;
      if (req.body.accountType) {
        req.body.accountType = normalizeAccountType(req.body.accountType);
      }
      if (req.body.policyDetails?.coApplicants) {
        const list = Array.isArray(req.body.policyDetails.coApplicants)
          ? req.body.policyDetails.coApplicants
          : [req.body.policyDetails.coApplicants];
        req.body.policyDetails.coApplicants = list
          .map((item: any) => String(item || "").trim())
          .filter(Boolean);
      }

      // Validate policyDetails against loanType if both are provided (skip for draft)
      // This must run AFTER processFileUploads since files are moved to policyDetails
      const isDraft = req.body.status === ApplicationStatus.DRAFT;
      if (
        !isDraft &&
        req.body.loanType &&
        req.body.policyDetails &&
        Object.keys(req.body.policyDetails).length > 0
      ) {
        const allowed = allowedFieldsByFormType[req.body.loanType] || [];
        const invalidFields = Object.keys(req.body.policyDetails).filter(
          (field) => !allowed.includes(field)
        );
        if (invalidFields.length > 0) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                `Field(s) "${invalidFields.join(
                  ", "
                )}" is/are not allowed for ${
                  req.body.loanType
                }. Allowed fields: ${allowed.join(", ")}`
              )
            );
        }
      }

      // Check if user already has an active loan query with the same loanType
      // User can only have one loanType until status is completed/approved/cancelled
      if (req.body.loanType) {
        const existingQuery = await LoanQuery.findOne({
          customerId: customerId,
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
                `You already have an active ${req.body.loanType} loan query. Please complete, approve, or cancel the existing query before creating a new one.`
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
        result = new LoanQuery(draftData);
        await result.save({ validateBeforeSave: false });

        // Add created activity
        result.activities = result.activities || [];
        result.activities.push({
          type: LoanQueryActivityType.CREATED,
          description: "Loan query created as draft",
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: "User",
          createdAt: new Date(),
        });
        await result.save({ validateBeforeSave: false });
      } else {
        // For non-draft status, use normal validation
        const createData = { ...req.body, activities: [] };
        result = await loanQueryService.create(createData);

        // Add created activity
        result.activities = result.activities || [];
        result.activities.push({
          type: LoanQueryActivityType.CREATED,
          description: "Loan query created",
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: "User",
          createdAt: new Date(),
        });

        // Auto-assign lander if not already assigned
        if (result && !result.assignedLander) {
          const session = (req as any).mongoSession;
          result = await LanderAssignmentEngine.ensureAssignment(result, {
            actorId: customerId?.toString(),
            reason: "new_loan_query",
            session,
          });
          await result.save({ session });
        } else {
          await result.save();
        }
      }

      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create loan query"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Loan query created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllQueries(req: Request, res: Response, next: NextFunction) {
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
      // if (!req.query.status) {
      //   req.query.status = { $ne: ApplicationStatus.DRAFT };
      // }

      // Add lookup stages to populate assignedAgent and assignedLander
      const populateStages = [
        {
          $lookup: {
            from: "agents",
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
          $addFields: {
            assignedAgent: {
              $cond: {
                if: { $ifNull: ["$assignedAgentData", false] },
                then: {
                  _id: "$assignedAgentData._id",
                  name: "$assignedAgentData.name",
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
          },
        },
        {
          $project: {
            assignedAgentData: 0,
            assignedLanderData: 0,
          },
        },
      ];

      const loanQueries = await loanQueryService.getAll(
        req.query,
        populateStages
      );
      return res
        .status(200)
        .json(
          new ApiResponse(200, loanQueries, "Loan queries fetched successfully")
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
        role !== "admin"
      );

      // Ensure user can only view their own queries (unless admin)
      if (
        role !== "admin" &&
        result?.customerId?._id?.toString() !== customerId
      ) {
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
    next: NextFunction
  ) {
    try {
      const customerId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      //only draft queries can be updated
      const existingResult = await loanQueryService.getById(
        req.params.id,
        true
      );
      if (existingResult?.status !== ApplicationStatus.DRAFT) {
        return res
          .status(400)
          .json(new ApiError(400, "Only draft queries can be updated"));
      }

      // Ensure user can only update their own queries (unless admin)
      if (
        role !== "admin" &&
        existingResult.customerId?._id?.toString() !== customerId
      ) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update your own loan queries"));
      }

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Prevent changing customerId
      delete req.body.customerId;
      if (req.body.accountType) {
        req.body.accountType = normalizeAccountType(req.body.accountType);
      }

      // Merge with existing policyDetails if updating
      if (req.body.policyDetails && existingResult.policyDetails) {
        req.body.policyDetails = {
          ...existingResult.policyDetails,
          ...req.body.policyDetails,
        };
      }

      // Merge with existing documents if updating
      if (req.body.documents && existingResult.documents) {
        req.body.documents = {
          ...existingResult.documents,
          ...req.body.documents,
        };
      }

      const updatedResult = await loanQueryService.updateById(
        req.params.id,
        req.body,
        {
          populate: true,
          new: true,
          runValidators: true,
        }
      );

      // Track status change
      if (updatedResult && existingResult?.status !== updatedResult.status) {
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: LoanQueryActivityType.STATUS_CHANGED,
          description: `Status changed from ${existingResult?.status} to ${updatedResult.status}`,
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: role === "admin" ? "Admin" : "User",
          payload: {
            previousStatus: existingResult?.status,
            newStatus: updatedResult.status,
          },
          createdAt: new Date(),
        });
      } else {
        // Track update if status didn't change
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: LoanQueryActivityType.UPDATED,
          description: "Loan query updated",
          actor: customerId
            ? new Types.ObjectId(String(customerId))
            : undefined,
          actorModel: role === "admin" ? "Admin" : "User",
          createdAt: new Date(),
        });
      }

      // Auto-assign lander if status changed from draft to non-draft and no lander assigned
      if (
        updatedResult &&
        existingResult?.status === ApplicationStatus.DRAFT &&
        updatedResult.status !== ApplicationStatus.DRAFT &&
        !updatedResult.assignedLander
      ) {
        const session = (req as any).mongoSession;
        const result = await LanderAssignmentEngine.ensureAssignment(
          updatedResult,
          {
            actorId: customerId?.toString(),
            reason: "draft_submitted",
            session,
          }
        );
        await result.save({ session });
        return res
          .status(200)
          .json(
            new ApiResponse(200, result, "Loan query updated successfully")
          );
      }

      await updatedResult.save();
      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedResult, "Loan query updated successfully")
        );
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
      const result = await loanQueryService.deleteById(req.params.id);
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
        true
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

      // Update assignedLander and add activity
      const updatedResult = await loanQueryService.updateById(
        req.params.id,
        {
          assignedLander: landerId,
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
          new: true,
          runValidators: true,
        }
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
        1
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

  // ====== DETAIL VIEW AND OPERATIONS FOR ADMIN PANEL ======

  static async getQueryDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await LoanQuery.findById(req.params.id)
        .populate(
          "customerId",
          "name email mobile profilePictureUrl cibilScore cibilLastFetchedAt cibilReport cibilRequestPayload cibilPdfLastFetchedAt cibilPdfReport digiLockerVault"
        )
        .populate("assignedAgent", "name email mobile profilePictureUrl")
        .populate("assignedLander", "name email mobile profilePictureUrl")
        .lean();

      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Check permissions - landers should use their own routes at /lander/*
      if (
        role === "lander" &&
        query.assignedLander?._id?.toString() !== userId
      ) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only view queries assigned to you"));
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
            "Loan query details fetched successfully"
          )
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

      if (!note) {
        return res.status(400).json(new ApiError(400, "Note is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only add notes to queries assigned to you"
            )
          );
      }

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.NOTE_ADDED,
        description: note,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Note added successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { status, remarks } = req.body;

      if (!status) {
        return res.status(400).json(new ApiError(400, "Status is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update status of queries assigned to you"
            )
          );
      }

      const oldStatus = query.status;
      query.status = status;

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.STATUS_CHANGED,
        description: `Status changed from ${oldStatus} to ${status}${
          remarks ? `: ${remarks}` : ""
        }`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: {
          oldStatus,
          newStatus: status,
          remarks,
        },
        createdAt: new Date(),
      });

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

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update documents of queries assigned to you"
            )
          );
      }

      // Handle file uploads from multer/S3 middleware
      let documentsToAdd: Record<string, string> = {};

      // Files uploaded via multer middleware will be in req.body with URLs
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
          const urlData = req.body[docType];
          // Extract URL from multer/S3 response format
          const url = Array.isArray(urlData)
            ? urlData[0]?.url
            : urlData?.url || urlData;
          if (url) {
            documentsToAdd[docType] = url;
          }
        }
      });

      // Also support direct URL input via documents object
      if (req.body.documents && typeof req.body.documents === "object") {
        documentsToAdd = { ...documentsToAdd, ...req.body.documents };
      }

      if (Object.keys(documentsToAdd).length === 0) {
        return res.status(400).json(new ApiError(400, "No documents provided"));
      }

      // Merge documents
      query.documents = { ...query.documents, ...documentsToAdd };

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.DOCUMENT_UPLOADED,
        description: `Documents uploaded: ${Object.keys(documentsToAdd).join(
          ", "
        )}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: { uploadedDocuments: Object.keys(documentsToAdd) },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Documents updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePolicyDocuments(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actorId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update policy documents of queries assigned to you"
            )
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
        if (urls.length === 0) return;
        incoming[field] = urls.length === 1 ? urls[0] : urls;
      });

      const bankStatementUrl = extractFileUrl(req.body?.bankStatementUrl);

      const allowed = allowedFieldsByFormType[query.loanType] || [];
      const invalidFields = Object.keys(incoming).filter(
        (field) => !allowed.includes(field)
      );
      if (invalidFields.length > 0) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              `Field(s) "${invalidFields.join(
                ", "
              )}" is/are not allowed for ${query.loanType}`
            )
          );
      }

      if (!bankStatementUrl && Object.keys(incoming).length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No policy documents provided"));
      }

      if (Object.keys(incoming).length > 0) {
        query.policyDetails = { ...query.policyDetails, ...incoming };
      }
      if (bankStatementUrl) {
        query.bankStatementUrl = bankStatementUrl;
      }

      const uploadedFields = [
        ...Object.keys(incoming),
        ...(bankStatementUrl ? ["bankStatementUrl"] : []),
      ];

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.DOCUMENT_UPLOADED,
        description: `Policy documents uploaded: ${uploadedFields.join(", ")}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: { uploadedDocuments: uploadedFields },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(
          new ApiResponse(200, query, "Policy documents updated successfully")
        );
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

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(
            new ApiError(
              403,
              "You can only update policy details of queries assigned to you"
            )
          );
      }

      // Merge policy details
      query.policyDetails = { ...query.policyDetails, ...policyDetails };

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.UPDATED,
        description: `Policy details updated`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: { updatedFields: Object.keys(policyDetails) },
        createdAt: new Date(),
      });

      await query.save();

      return res
        .status(200)
        .json(
          new ApiResponse(200, query, "Policy details updated successfully")
        );
    } catch (err) {
      next(err);
    }
  }

  static async reassignLander(req: Request, res: Response, next: NextFunction) {
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
        return res.status(400).json(new ApiError(400, "Lander ID is required"));
      }

      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      const lander = await Lander.findById(landerId).select("name email");
      if (!lander) {
        return res.status(404).json(new ApiError(404, "Lander not found"));
      }

      const actorId = (req as any).user?._id;
      const previousLanderId = query.assignedLander;

      query.assignedLander = new Types.ObjectId(landerId);

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.LANDER_ASSIGNED,
        description: `Lander reassigned to ${lander.name}${
          reason ? `: ${reason}` : ""
        }`,
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
      });

      await query.save();

      // Adjust lander loads
      if (
        previousLanderId &&
        previousLanderId.toString() !== landerId.toString()
      ) {
        await LanderAssignmentEngine.adjustLanderLoad(previousLanderId, -1);
      }
      await LanderAssignmentEngine.adjustLanderLoad(
        new Types.ObjectId(landerId),
        1
      );

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Lander reassigned successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async completeQuery(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user || {};
      const actorId = (req as any).user?._id;
      const { remarks } = req.body;

      // Only admin or assigned lander can complete a query
      const query = await LoanQuery.findById(req.params.id);
      if (!query) {
        return res.status(404).json(new ApiError(404, "Loan query not found"));
      }

      // Check permissions for lander
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(
            new ApiError(403, "You can only complete queries assigned to you")
          );
      }

      // Check if query is in a valid state to be completed
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

      console.log(`🏁 Completing loan query ${query._id}`);
      console.log(`  Current status: ${query.status}`);
      console.log(`  Completed by: ${role} (${actorId})`);
      console.log(`  Assigned Lander: ${query.assignedLander}`);

      const oldStatus = query.status;
      query.status = "completed" as any;

      query.activities = query.activities || [];
      query.activities.push({
        type: LoanQueryActivityType.STATUS_CHANGED,
        description: `Query completed${remarks ? `: ${remarks}` : ""}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: {
          oldStatus,
          newStatus: "completed",
          remarks,
        },
        createdAt: new Date(),
      });

      await query.save();

      // Adjust lander load - reduce by 1 as this query is now completed
      if (query.assignedLander) {
        console.log(`  📉 Adjusting lander load for ${query.assignedLander}`);
        await LanderAssignmentEngine.adjustLanderLoad(query.assignedLander, -1);
        console.log(`  ✅ Lander load decreased`);
      }

      console.log(`✅ Loan query ${query._id} marked as completed`);

      return res
        .status(200)
        .json(new ApiResponse(200, query, "Loan query completed successfully"));
    } catch (err) {
      next(err);
    }
  }
}
