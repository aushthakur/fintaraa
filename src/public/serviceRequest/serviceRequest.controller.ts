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
        if (serviceType) query.serviceType = serviceType;
      }
      if (req.query?.status) query.status = req.query.status;
      const result = await ServiceRequest.find(query)
        .sort({ updatedAt: -1 })
        .limit(Math.min(Number(req.query?.limit) || 50, 200))
        .lean();
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Service requests fetched"));
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
        updatedBy:
          index === stageIndex
            ? safeString(req.body?.updatedBy) || "Admin"
            : item.updatedBy,
        updatedAt: index === stageIndex ? new Date() : item.updatedAt,
      }));
      request.currentStage = stage;
      request.currentStageIndex = stageIndex;
      request.assignedExecutive =
        safeString(req.body?.assignedExecutive) || request.assignedExecutive;
      request.status =
        stage === "Completed"
          ? ServiceRequestStatus.COMPLETED
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
