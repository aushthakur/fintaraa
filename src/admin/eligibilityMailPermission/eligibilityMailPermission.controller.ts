import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import Admin from "../../modals/admin.model";
import { CommonService } from "../../services/common.services";
import { EligibilityMailPermission } from "../../modals/eligibilityMailPermission.model";
import {
  checkEligibilityMailAccess,
  getEligibilityMailPermissionOptions,
  normalizeEnumArray,
} from "./eligibilityMailPermission.utils";

const EligibilityMailPermissionService = new CommonService(
  EligibilityMailPermission,
);

const normalizeBoolean = (value: any, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "inactive"].includes(normalized)) return false;
  }
  return fallback;
};

const sanitizePayload = (payload: any = {}, userId?: string) => {
  const options = getEligibilityMailPermissionOptions();

  return {
    agent: payload.agent,
    loanTypes: normalizeEnumArray(payload.loanTypes, options.loanTypes),
    insuranceTypes: normalizeEnumArray(
      payload.insuranceTypes,
      options.insuranceTypes,
    ),
    allowAllLoanTypes: normalizeBoolean(payload.allowAllLoanTypes, false),
    allowAllInsuranceTypes: normalizeBoolean(
      payload.allowAllInsuranceTypes,
      false,
    ),
    status: normalizeBoolean(payload.status, true),
    ...(userId ? { updatedBy: userId } : {}),
  };
};

const permissionLookupStages = [
  {
    $lookup: {
      from: "admins",
      localField: "agent",
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
      from: "roles",
      localField: "agentData.role",
      foreignField: "_id",
      as: "roleData",
    },
  },
  {
    $unwind: {
      path: "$roleData",
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $project: {
      _id: 1,
      agent: 1,
      loanTypes: 1,
      insuranceTypes: 1,
      allowAllLoanTypes: 1,
      allowAllInsuranceTypes: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
      agentName: {
        $ifNull: ["$agentData.name", "$agentData.username"],
      },
      agentEmail: "$agentData.email",
      agentMobile: "$agentData.mobile",
      agentRole: "$roleData.name",
    },
  },
];

export class EligibilityMailPermissionController {
  static async getOptions(req: Request, res: Response) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          getEligibilityMailPermissionOptions(),
          "Options fetched successfully",
        ),
      );
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityMailPermissionService.getAll(
        req.query,
        permissionLookupStages,
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizePayload(req.body, (req as any)?.user?._id);
      if (!payload.agent) {
        return res
          .status(400)
          .json(new ApiError(400, "Agent is required"));
      }

      const agent = await Admin.findById(payload.agent).populate("role");
      if (!agent) {
        return res.status(404).json(new ApiError(404, "Agent not found"));
      }

      const roleName = String((agent as any)?.role?.name || "").toLowerCase();
      if (roleName !== "agent") {
        return res
          .status(400)
          .json(new ApiError(400, "Only agent users can receive this rule"));
      }

      const existing = await EligibilityMailPermission.findOne({
        agent: payload.agent,
      }).lean();
      if (existing) {
        return res
          .status(409)
          .json(new ApiError(409, "Permission rule already exists for this agent"));
      }

      const result = await EligibilityMailPermissionService.create({
        ...payload,
        createdBy: (req as any)?.user?._id,
      } as any);

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityMailPermission.findById(
        req.params.id,
      ).populate("agent", "name username email mobile");
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Permission rule not found"));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const current = await EligibilityMailPermission.findById(req.params.id);
      if (!current) {
        return res
          .status(404)
          .json(new ApiError(404, "Permission rule not found"));
      }

      const payload = sanitizePayload(req.body, (req as any)?.user?._id);
      if (!payload.agent) {
        payload.agent = String(current.agent);
      }

      const agent = await Admin.findById(payload.agent).populate("role");
      if (!agent) {
        return res.status(404).json(new ApiError(404, "Agent not found"));
      }

      const roleName = String((agent as any)?.role?.name || "").toLowerCase();
      if (roleName !== "agent") {
        return res
          .status(400)
          .json(new ApiError(400, "Only agent users can receive this rule"));
      }

      const duplicate = await EligibilityMailPermission.findOne({
        agent: payload.agent,
        _id: { $ne: req.params.id },
      }).lean();
      if (duplicate) {
        return res
          .status(409)
          .json(new ApiError(409, "Permission rule already exists for this agent"));
      }

      const result = await EligibilityMailPermissionService.updateById(
        req.params.id,
        payload as any,
      );

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityMailPermissionService.deleteById(
        req.params.id,
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Permission rule not found"));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any)?.user?._id;
      const userRole = (req as any)?.user?.role;
      const queryType = String(req.query?.queryType || "loan").toLowerCase();
      const loanType = String(req.query?.loanType || "");
      const insuranceType = String(req.query?.insuranceType || "");

      if (queryType !== "loan" && queryType !== "insurance") {
        return res
          .status(400)
          .json(new ApiError(400, "queryType must be loan or insurance"));
      }

      const access = await checkEligibilityMailAccess({
        userId,
        userRole,
        queryType: queryType as "loan" | "insurance",
        loanType,
        insuranceType,
      });

      return res
        .status(200)
        .json(new ApiResponse(200, access, "Access fetched successfully"));
    } catch (err) {
      next(err);
    }
  }
}
