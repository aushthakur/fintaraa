import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import {
  ServiceRequest,
  ServiceRequestType,
  ServiceWorkflowItem,
  ServiceRequestStatus,
} from "../../modals/serviceRequest.model";
import {
  allocatePrefixedSequence,
  formatYearMonthDaySequencePrefix,
} from "../../utils/idAllocator";

const GST_STAGES = [
  "Request Submitted",
  "Documents Pending",
  "Documents Received",
  "Verification",
  "GST Application Filed",
  "ARN Generated",
  "Approval Pending",
  "GST Issued",
  "Completed",
];

const ITR_STAGES = [
  "Request Submitted",
  "Documents Pending",
  "Documents Received",
  "Tax Review",
  "Return Prepared",
  "Client Approval",
  "Return Filed",
  "Acknowledgement Generated",
  "Completed",
];

const COMPANY_STAGES = [
  "Inquiry Submitted",
  "Expert Assigned",
  "Requirements Reviewed",
  "Documents Pending",
  "Documents Received",
  "Application Prepared",
  "Client Approval",
  "Filing Submitted",
  "Completed",
];

const ANNUAL_COMPLIANCE_STAGES = [
  "Request Submitted",
  "Compliance Expert Assigned",
  "Filing Scope Reviewed",
  "Documents Pending",
  "Documents Received",
  "Filings Prepared",
  "Client Approval",
  "Filings Submitted",
  "Completed",
];

const ROC_FILING_STAGES = [
  "Request Submitted",
  "Compliance Expert Assigned",
  "Filing Scope Reviewed",
  "Documents Pending",
  "Documents Received",
  "Forms Prepared",
  "Client Approval",
  "ROC Filing Submitted",
  "SRN / Acknowledgement Generated",
  "Completed",
];

const TAX_COMPLIANCE_STAGES = [
  "Request Submitted",
  "Tax Expert Assigned",
  "Requirement Reviewed",
  "Documents Pending",
  "Documents Received",
  "Tax Review",
  "Response or Filing Prepared",
  "Submission Completed",
  "Completed",
];

const MSME_STAGES = [
  "Request Submitted",
  "Registration Expert Assigned",
  "Eligibility Reviewed",
  "Documents Pending",
  "Documents Received",
  "Application Prepared",
  "Udyam Application Submitted",
  "Certificate Assistance",
  "Completed",
];

const PROJECT_REPORT_STAGES = [
  "Request Submitted",
  "Business Analyst Assigned",
  "Report Scope Reviewed",
  "Information Pending",
  "Financial Analysis",
  "Draft Report Prepared",
  "Client Review",
  "Final Report Delivered",
  "Completed",
];

const FRANCHISE_STAGES = [
  "Inquiry Submitted",
  "Partnership Team Assigned",
  "Profile Review",
  "Location Review",
  "Commercial Discussion",
  "Documentation",
  "Agreement Shared",
  "Onboarding",
  "Completed",
];

const DSA_STAGES = [
  "Inquiry Submitted",
  "Partnership Team Assigned",
  "Profile Review",
  "KYC Pending",
  "KYC Completed",
  "Agreement Shared",
  "Training Scheduled",
  "Partner Activated",
  "Completed",
];

const stageList = (serviceType: ServiceRequestType) =>
  ({
    [ServiceRequestType.GST]: GST_STAGES,
    [ServiceRequestType.ITR]: ITR_STAGES,
    [ServiceRequestType.COMPANY]: COMPANY_STAGES,
    [ServiceRequestType.ANNUAL_COMPLIANCE]: ANNUAL_COMPLIANCE_STAGES,
    [ServiceRequestType.ROC_FILING]: ROC_FILING_STAGES,
    [ServiceRequestType.TAX_COMPLIANCE]: TAX_COMPLIANCE_STAGES,
    [ServiceRequestType.MSME]: MSME_STAGES,
    [ServiceRequestType.PROJECT_REPORT]: PROJECT_REPORT_STAGES,
    [ServiceRequestType.FRANCHISE]: FRANCHISE_STAGES,
    [ServiceRequestType.DSA]: DSA_STAGES,
  })[serviceType] || GST_STAGES;

const buildTimeline = (
  serviceType: ServiceRequestType,
): ServiceWorkflowItem[] =>
  stageList(serviceType).map((stage, index) => ({
    stage,
    status: index === 0 ? "active" : "pending",
    remarks:
      index === 0
        ? "Your request has been received and a query ID has been generated."
        : "",
    updatedBy: index === 0 ? "System" : "",
    updatedAt: index === 0 ? new Date() : undefined,
  }));

const normalizeServiceType = (value: unknown) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "gst" || raw === "gst_registration")
    return ServiceRequestType.GST;
  if (raw === "itr" || raw === "itr_filing") return ServiceRequestType.ITR;
  if (
    raw === "company" ||
    raw === "company_registration" ||
    raw === "company-registration"
  )
    return ServiceRequestType.COMPANY;
  if (
    raw === "annual_compliance" ||
    raw === "annual-compliance" ||
    raw === "annual compliance"
  )
    return ServiceRequestType.ANNUAL_COMPLIANCE;
  if (
    raw === "roc" ||
    raw === "roc_filing" ||
    raw === "roc-filing" ||
    raw === "roc filing"
  )
    return ServiceRequestType.ROC_FILING;
  if (
    raw === "tax_compliance" ||
    raw === "tax-compliance" ||
    raw === "tax_compliances" ||
    raw === "tax compliances"
  )
    return ServiceRequestType.TAX_COMPLIANCE;
  if (
    raw === "msme" ||
    raw === "msme_registration" ||
    raw === "msme-registration" ||
    raw === "udyam_registration"
  )
    return ServiceRequestType.MSME;
  if (
    raw === "project_report" ||
    raw === "project-report" ||
    raw === "project report"
  )
    return ServiceRequestType.PROJECT_REPORT;
  if (
    raw === "franchise" ||
    raw === "franchise_partner" ||
    raw === "franchise-partner"
  )
    return ServiceRequestType.FRANCHISE;
  if (raw === "dsa" || raw === "dsa_partner" || raw === "dsa-partner")
    return ServiceRequestType.DSA;
  return undefined;
};

const makeQueryId = async () => {
  const date = new Date();
  const datePart = formatYearMonthDaySequencePrefix(date);
  return allocatePrefixedSequence({
    key: `service-request:${datePart}`,
    prefix: `FIN${datePart}`,
    padLength: 4,
  });
};

const safeString = (value: unknown) => String(value || "").trim();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeMobile = (value: unknown) =>
  safeString(value).replace(/[\s-]/g, "").replace(/^\+91/, "");

const normalizeStageStatus = (
  value: unknown,
): ServiceWorkflowItem["status"] => {
  const status = safeString(value) as ServiceWorkflowItem["status"];
  return ["pending", "active", "completed", "blocked"].includes(status)
    ? status
    : "active";
};

const hasOwn = (value: unknown, key: string) =>
  Boolean(
    value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, key),
  );

export class ServiceRequestController {
  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const serviceType = normalizeServiceType(req.body?.serviceType);
      if (!serviceType) {
        return res.status(400).json(new ApiError(400, "Invalid service type"));
      }
      const mobile = normalizeMobile(req.body?.mobile);
      if (!mobile) {
        return res
          .status(400)
          .json(new ApiError(400, "Mobile number is required"));
      }

      let queryId = await makeQueryId();
      while (
        await ServiceRequest.exists({ queryId, recordType: "service_request" })
      ) {
        queryId = await makeQueryId();
      }

      const timeline = buildTimeline(serviceType);
      const source = safeString(req.body?.source) || "website";
      const platform =
        safeString(req.body?.platform) ||
        safeString(req.body?.sourcePlatform) ||
        "website";
      const communicationConsent =
        req.body?.communicationConsent &&
        typeof req.body.communicationConsent === "object"
          ? req.body.communicationConsent
          : {};
      const whatsappConsent =
        req.body?.whatsappConsent === true ||
        req.body?.whatsappConsent === "true" ||
        (communicationConsent as any)?.whatsapp === true;
      const details =
        req.body?.details && typeof req.body.details === "object"
          ? req.body.details
          : {};
      const request = await ServiceRequest.create({
        recordType: "service_request",
        queryId,
        serviceType,
        user: req.user?._id,
        name: safeString(req.body?.name),
        mobile,
        email: safeString(req.body?.email),
        businessName: safeString(req.body?.businessName),
        monthlyLoanAmount:
          serviceType === ServiceRequestType.DSA
            ? safeString(
                req.body?.monthlyLoanAmount ||
                  (details as Record<string, unknown>)?.monthlyLoanAmount ||
                  (details as Record<string, unknown>)?.["Monthly Loan Amount"],
              )
            : undefined,
        businessType: safeString(req.body?.businessType),
        gstRequirement: safeString(req.body?.gstRequirement),
        state: safeString(req.body?.state),
        employmentType: safeString(req.body?.employmentType),
        annualIncome: safeString(req.body?.annualIncome),
        source,
        platform,
        whatsappConsent,
        communicationConsent,
        details: {
          ...details,
          source: details.source || source,
          platform: details.platform || platform,
          whatsappConsent,
          communicationConsent,
        },
        currentStage: timeline[0].stage,
        currentStageIndex: 0,
        timeline,
      });

      return res
        .status(201)
        .json(new ApiResponse(201, request, "Service request created"));
    } catch (err) {
      next(err);
    }
  }

  static async getByQueryId(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ServiceRequest.findOne({
        recordType: "service_request",
        queryId: req.params.queryId,
      }).lean();
      if (!result) {
        return res.status(404).json(new ApiError(404, "Request not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Service request fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async getPublicHistory(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const serviceType = normalizeServiceType(req.query?.serviceType);
      if (!serviceType) {
        return res.status(400).json(new ApiError(400, "Invalid service type"));
      }

      const mobile = normalizeMobile(req.query?.mobile);
      const queryId = safeString(req.query?.queryId).toUpperCase();
      const userId = req.user?._id;
      if (!mobile && !queryId && !userId) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Mobile number, query ID or logged-in user is required",
            ),
          );
      }

      const query: any = { recordType: "service_request", serviceType };
      if (queryId) query.queryId = queryId;
      else if (mobile) query.mobile = mobile;
      else if (userId) query.user = userId;

      const result = await ServiceRequest.find(query)
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean();

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Service request history fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query: any = { recordType: "service_request" };

      if (req.query?.serviceType) {
        const serviceType = normalizeServiceType(req.query.serviceType);
        if (!serviceType) {
          return res.status(400).json(new ApiError(400, "Invalid service type"));
        }
        query.serviceType = serviceType;
      }
      for (const field of [
        "status",
        "currentStage",
        "followUpStatus",
        "source",
        "platform",
        "queryId",
        "mobile",
      ]) {
        const value = safeString(req.query?.[field]);
        if (value) query[field] = value;
      }

      const search = safeString(req.query?.search);
      const selectedField =
        safeString(req.query?.selectedField) ||
        safeString(req.query?.searchkey);
      const searchableFields = [
        "queryId",
        "serviceType",
        "name",
        "businessName",
        "monthlyLoanAmount",
        "mobile",
        "email",
        "status",
        "currentStage",
        "source",
        "platform",
      ];
      if (search) {
        const match = { $regex: escapeRegExp(search), $options: "i" };
        if (searchableFields.includes(selectedField)) {
          query[selectedField] =
            selectedField === "serviceType"
              ? normalizeServiceType(search) || match
              : match;
        } else {
          query.$or = searchableFields.map((field) => ({ [field]: match }));
        }
      }

      const startDate = safeString(req.query?.startDate);
      const endDate = safeString(req.query?.endDate);
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          const start = new Date(`${startDate}T00:00:00.000Z`);
          if (!Number.isNaN(start.getTime())) query.createdAt.$gte = start;
        }
        if (endDate) {
          const end = new Date(`${endDate}T23:59:59.999Z`);
          if (!Number.isNaN(end.getTime())) query.createdAt.$lte = end;
        }
        if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
      }

      const page = Math.max(Number(req.query?.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 200);
      const sortableFields = new Set([
        "queryId",
        "serviceType",
        "name",
        "businessName",
        "monthlyLoanAmount",
        "mobile",
        "email",
        "status",
        "currentStage",
        "assignedExecutive",
        "followUpAt",
        "followUpStatus",
        "source",
        "platform",
        "createdAt",
        "updatedAt",
      ]);
      const requestedSortKey = safeString(req.query?.sortKey);
      const sortKey = sortableFields.has(requestedSortKey)
        ? requestedSortKey
        : "updatedAt";
      const sortDir =
        safeString(req.query?.sortDir).toLowerCase() === "asc" ||
        safeString(req.query?.sortDir) === "1"
          ? 1
          : -1;

      const [result, totalItems] = await Promise.all([
        ServiceRequest.find(query)
          .sort({ [sortKey]: sortDir })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        ServiceRequest.countDocuments(query),
      ]);
      const normalizedResult = result.map((item) => {
        const details = (item.details || {}) as Record<string, unknown>;
        const monthlyLoanAmount =
          safeString(item.monthlyLoanAmount) ||
          safeString(details.monthlyLoanAmount) ||
          safeString(details["Monthly Loan Amount"]) ||
          safeString(details["Monthly Lead Volume"]);

        return monthlyLoanAmount && !item.monthlyLoanAmount
          ? { ...item, monthlyLoanAmount }
          : item;
      });

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            {
              result: normalizedResult,
              pagination: {
                totalPages: Math.max(Math.ceil(totalItems / limit), 1),
                totalItems,
                currentPage: page,
                itemsPerPage: limit,
              },
            },
            "Service requests fetched",
          ),
        );
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const update: Record<string, any> = { ...req.body };
      delete update.timeline;
      const result = await ServiceRequest.findOneAndUpdate(
        { _id: req.params.id, recordType: "service_request" },
        update,
        { new: true, runValidators: true },
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "Request not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Service request updated"));
    } catch (err) {
      next(err);
    }
  }

  static async getAdminById(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await ServiceRequest.findOne({
        _id: req.params.id,
        recordType: "service_request",
      }).lean();
      if (!result) {
        return res.status(404).json(new ApiError(404, "Request not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Service request fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async updateStage(req: Request, res: Response, next: NextFunction) {
    try {
      const request = await ServiceRequest.findOne({
        _id: req.params.id,
        recordType: "service_request",
      });
      if (!request) {
        return res.status(404).json(new ApiError(404, "Request not found"));
      }

      const stage = safeString(req.body?.stage);
      const stageIndex = request.timeline.findIndex(
        (item) => item.stage === stage,
      );
      if (stageIndex === -1) {
        return res.status(400).json(new ApiError(400, "Invalid stage"));
      }

      const updatedBy =
        safeString((req as any).user?.name) ||
        safeString((req as any).user?.fullName) ||
        safeString(req.body?.updatedBy) ||
        "Admin";
      request.timeline = request.timeline.map((item, index) => ({
        stage: item.stage,
        status:
          index < stageIndex
            ? "completed"
            : index === stageIndex
              ? normalizeStageStatus(req.body?.stageStatus)
              : "pending",
        remarks:
          index === stageIndex
            ? safeString(req.body?.remarks) || item.remarks
            : item.remarks,
        updatedBy: index === stageIndex ? updatedBy : item.updatedBy,
        updatedAt: index === stageIndex ? new Date() : item.updatedAt,
      }));
      request.currentStage = stage;
      request.currentStageIndex = stageIndex;
      const hadFollowUp = Boolean(request.followUpAt || request.followUpNote);
      if (hasOwn(req.body, "assignedExecutive")) {
        request.assignedExecutive =
          safeString(req.body?.assignedExecutive) || undefined;
      }

      if (hasOwn(req.body, "followUpAt")) {
        const rawFollowUpAt = safeString(req.body?.followUpAt);
        if (!rawFollowUpAt) {
          request.followUpAt = undefined;
        } else {
          const followUpAt = new Date(rawFollowUpAt);
          if (Number.isNaN(followUpAt.getTime())) {
            return res
              .status(400)
              .json(new ApiError(400, "Invalid follow-up date"));
          }
          request.followUpAt = followUpAt;
        }
      }
      if (hasOwn(req.body, "followUpNote")) {
        request.followUpNote = safeString(req.body?.followUpNote) || undefined;
      }

      const followUpStatus = safeString(req.body?.followUpStatus);
      if (["pending", "completed", "cancelled"].includes(followUpStatus)) {
        request.followUpStatus = followUpStatus as
          | "pending"
          | "completed"
          | "cancelled";
      }

      const hasFollowUpUpdate =
        ["followUpAt", "followUpNote", "followUpStatus"].some((field) =>
          hasOwn(req.body, field),
        ) &&
        Boolean(hadFollowUp || request.followUpAt || request.followUpNote);
      if (hasFollowUpUpdate) {
        request.followUpHistory = [
          ...(request.followUpHistory || []),
          {
            scheduledAt: request.followUpAt,
            note: request.followUpNote,
            status: request.followUpStatus || "pending",
            assignedExecutive: request.assignedExecutive,
            updatedBy,
            updatedAt: new Date(),
          },
        ];
      }

      const requestedStatus = safeString(req.body?.status);
      const validStatuses = Object.values(ServiceRequestStatus) as string[];
      request.status =
        stage === "Completed"
          ? ServiceRequestStatus.COMPLETED
          : validStatuses.includes(requestedStatus)
            ? (requestedStatus as ServiceRequestStatus)
            : ServiceRequestStatus.IN_PROGRESS;
      await request.save();

      return res
        .status(200)
        .json(new ApiResponse(200, request, "Service request stage updated"));
    } catch (err) {
      next(err);
    }
  }
}
