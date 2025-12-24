import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { InsuranceQuery } from "../../modals/insurancequery.model";
import { ApplicationStatus, allowedFieldsByFormType, InsuranceQueryActivityType } from "../../modals/insurancequery.model";
import LanderAssignmentEngine from "../../services/landerAssignment.service";
import { Types } from "mongoose";
import Lander from "../../modals/lander.model";
import { User } from "../../modals/user.model";

  const insuranceQueryService = new CommonService(InsuranceQuery);

// Helper function to extract URL from uploaded file object
const extractFileUrl = (file: any): string | undefined => {
  if (!file) return undefined;
  if (typeof file === "string") return file;
  if (Array.isArray(file) && file.length > 0) {
    return file[0]?.url || file[0];
  }
  return file.url || file;
};

// Helper function to process uploaded files and map to request body
const processFileUploads = (req: Request) => {
  // Initialize policyDetails if it doesn't exist
  if (!req.body.policyDetails) {
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
      if (!customerId) {
        return res
          .status(401)
          .json(new ApiError(401, "User authentication required"));
      }

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Automatically set customerId from token
      req.body.customerId = customerId;
      const user = await User.findById(customerId);
      normalizeInsurancePayload(req, user);

      // Validate policyDetails against typeOfInsurance if both are provided (skip for draft)
      // This must run AFTER processFileUploads since files are moved to policyDetails
      const isDraft = req.body.status === ApplicationStatus.DRAFT;
      if (!isDraft && req.body.typeOfInsurance && req.body.policyDetails && Object.keys(req.body.policyDetails).length > 0) {
        const allowed = allowedFieldsByFormType[req.body.typeOfInsurance] || [];
        const invalidFields = Object.keys(req.body.policyDetails).filter(
          (field) => !allowed.includes(field)
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
        
        // Auto-assign lander if not already assigned
        if (result && !result.assignedLander) {
          const session = (req as any).mongoSession;
          result = await LanderAssignmentEngine.ensureAssignment(
            result,
            {
              actorId: customerId?.toString(),
              reason: "new_insurance_query",
              session,
            }
          );
          await result.save({ session });
        } else {
          await result.save();
        }
      }

      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create insurance query"));
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
      if (!req.query.status) {
        req.query.status = { $ne: ApplicationStatus.DRAFT };
      }
      
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
      
      const insuranceQueries = await insuranceQueryService.getAll(req.query, populateStages);
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
      
      //only draft queries can be updated
      const existingResult = await insuranceQueryService.getById(
        req.params.id,
        true,
        
      );
      if(existingResult?.status !== ApplicationStatus.DRAFT) {
        return res
          .status(400)
          .json(new ApiError(400, "Only draft queries can be updated"));
      }

      // Ensure user can only update their own queries (unless admin)
      if (role !== "admin" && existingResult.customerId?._id?.toString() !== customerId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update your own insurance queries"));
      }

      // Process uploaded files and map URLs
      processFileUploads(req);

      // Prevent changing customerId
      delete req.body.customerId;
      const user = await User.findById(customerId);
      normalizeInsurancePayload(req, user, existingResult);

      // Merge with existing policyDetails if updating
      if (req.body.policyDetails && existingResult.policyDetails) {
        req.body.policyDetails = {
          ...existingResult.policyDetails,
          ...req.body.policyDetails,
        };
      }

      const updatedResult = await insuranceQueryService.updateById(req.params.id, req.body, {
        populate: true,
        new: true,
        runValidators: true,
      });
      
      // Track status change
      if (updatedResult && existingResult?.status !== updatedResult.status) {
        updatedResult.activities = updatedResult.activities || [];
        updatedResult.activities.push({
          type: InsuranceQueryActivityType.STATUS_CHANGED,
          description: `Status changed from ${existingResult?.status} to ${updatedResult.status}`,
          actor: customerId ? new Types.ObjectId(String(customerId)) : undefined,
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
          type: InsuranceQueryActivityType.UPDATED,
          description: "Insurance query updated",
          actor: customerId ? new Types.ObjectId(String(customerId)) : undefined,
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
          .json(new ApiResponse(200, result, "Insurance query updated successfully"));
      }
      
      await updatedResult.save();
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
      const result = await insuranceQueryService.deleteById(req.params.id);
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

      // Update assignedLander
      const updatedResult = await insuranceQueryService.updateById(
        req.params.id,
        { assignedLander: landerId },
        {
          populate: [{ path: "assignedLander", select: "name email mobile" }],
          new: true,
          runValidators: true,
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
        .populate("assignedAgent", "name email mobile profilePictureUrl")
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

      // Ensure commission fields are always present (for backward compatibility with old documents)
      const responseData = {
        ...query,
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
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only update status of queries assigned to you"));
      }

      const oldStatus = query.status;
      query.status = status;

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.STATUS_CHANGED,
        description: `Status changed from ${oldStatus} to ${status}${remarks ? `: ${remarks}` : ""}`,
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
        if (req.body[docType]) {
          const urlData = req.body[docType];
          // Extract URL from multer/S3 response format
          const url = Array.isArray(urlData) ? urlData[0]?.url : urlData?.url || urlData;
          if (url && query.policyDetails) {
            query.policyDetails[docType] = url;
            uploadedDocs.push(docType);
          }
        }
      });

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
      if (role === "lander" && query.assignedLander?.toString() !== actorId) {
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

      query.activities = query.activities || [];
      query.activities.push({
        type: InsuranceQueryActivityType.STATUS_CHANGED,
        description: `Query completed${remarks ? `: ${remarks}` : ""}`,
        actor: actorId ? new Types.ObjectId(String(actorId)) : undefined,
        actorModel: role === "admin" ? "Admin" : "Lander",
        payload: {
          oldStatus,
          newStatus: ApplicationStatus.COMPLETED,
          remarks,
        },
        createdAt: new Date(),
      });

      await query.save();

      // Adjust lander load - reduce by 1 as this query is now completed
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
