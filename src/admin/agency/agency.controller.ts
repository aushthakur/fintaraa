import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Agency, AgencyRole } from "../../modals/agency.model";
import { UserStatus } from "../../modals/user.model";
import { AgencyCommissionTransaction } from "../../modals/agencyCommissionTransaction.model";
import { CommonService } from "../../services/common.services";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import { NextFunction, Request, Response } from "express";

const agencyService = new CommonService(Agency);
const ALLOWED_STATUSES = Object.values(UserStatus);
const ALLOWED_ROLES: AgencyRole[] = ["agency", "agency_member"];

const normalizeStatus = (value: any): UserStatus | null => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const status = ALLOWED_STATUSES.find((item) => item === normalized);
  return (status as UserStatus) || null;
};

const normalizeRole = (value: any): AgencyRole | null => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const role = ALLOWED_ROLES.find((item) => item === normalized);
  return role || null;
};

const normalizeBoolean = (value: any, fallback?: boolean) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "inactive"].includes(normalized)) return false;
  }
  return fallback;
};

const sanitizeAgencyCreatePayload = (payload: any = {}) => {
  const role =
    normalizeRole(payload.role) || (payload.parentAgency ? "agency_member" : "agency");
  const status = normalizeStatus(payload.status) || UserStatus.PENDING_VERIFICATION;
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  const name = String(payload.name || "").trim();
  const mobile = String(payload.mobile || "").trim();

  if (!name) throw new ApiError(400, "Name is required");
  if (!email) throw new ApiError(400, "Email is required");
  if (!mobile) throw new ApiError(400, "Mobile is required");

  const next: Record<string, any> = {
    name,
    email,
    mobile,
    role,
    status,
    parentAgency: payload.parentAgency || undefined,
    avatar: payload.avatar,
    profilePictureUrl: payload.profilePictureUrl,
    isEmailVerified: normalizeBoolean(payload.isEmailVerified, false),
    isMobileVerified: normalizeBoolean(payload.isMobileVerified, false),
    agreedToTerms: normalizeBoolean(payload.agreedToTerms, true),
    privacyPolicyAccepted: normalizeBoolean(payload.privacyPolicyAccepted, true),
  };

  if (payload.password) next.password = String(payload.password);
  if (role === "agency") next.parentAgency = undefined;

  return next;
};

const sanitizeAgencyUpdatePayload = (payload: any = {}) => {
  const next: Record<string, any> = {};

  if (payload.name !== undefined) next.name = payload.name;
  if (payload.email !== undefined)
    next.email = String(payload.email).trim().toLowerCase();
  if (payload.mobile !== undefined) next.mobile = payload.mobile;
  if (payload.avatar !== undefined) next.avatar = payload.avatar;
  if (payload.profilePictureUrl !== undefined) {
    next.profilePictureUrl = payload.profilePictureUrl;
  }
  if (payload.parentAgency !== undefined) {
    next.parentAgency = payload.parentAgency || undefined;
  }

  if (payload.role !== undefined) {
    const role = normalizeRole(payload.role);
    if (!role) throw new ApiError(400, "Invalid role");
    next.role = role;
    if (role === "agency") next.parentAgency = undefined;
  }

  if (payload.status !== undefined) {
    const status = normalizeStatus(payload.status);
    if (!status) throw new ApiError(400, "Invalid status");
    next.status = status;
  }

  if (payload.isEmailVerified !== undefined) {
    next.isEmailVerified = normalizeBoolean(payload.isEmailVerified, false);
  }
  if (payload.isMobileVerified !== undefined) {
    next.isMobileVerified = normalizeBoolean(payload.isMobileVerified, false);
  }
  if (payload.agreedToTerms !== undefined) {
    next.agreedToTerms = normalizeBoolean(payload.agreedToTerms, false);
  }
  if (payload.privacyPolicyAccepted !== undefined) {
    next.privacyPolicyAccepted = normalizeBoolean(
      payload.privacyPolicyAccepted,
      false,
    );
  }

  return next;
};

export class AgencyAdminController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizeAgencyCreatePayload(req.body);

      if (payload.role === "agency_member" && !payload.parentAgency) {
        return res
          .status(400)
          .json(new ApiError(400, "Parent agency is required for agency member"));
      }

      if (payload.parentAgency) {
        const parent = await Agency.findById(payload.parentAgency).select(
          "_id role",
        );
        if (!parent) {
          return res.status(404).json(new ApiError(404, "Parent agency not found"));
        }
      }

      const existing = await Agency.findOne({
        $or: [{ mobile: payload.mobile }, { email: payload.email }],
      }).select("_id mobile email");
      if (existing) {
        return res
          .status(409)
          .json(new ApiError(409, "Agency with mobile/email already exists"));
      }

      const result = await agencyService.create(payload);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Channel created successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "agencies",
            localField: "parentAgency",
            foreignField: "_id",
            as: "parentAgencyData",
          },
        },
        {
          $lookup: {
            from: "agencycommissiontransactions",
            let: { agencyId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$ownerAgency", "$$agencyId"],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  totalCommission: { $sum: "$commissionAmount" },
                  earnedCommission: {
                    $sum: {
                      $cond: [
                        { $eq: ["$earningStatus", "earned"] },
                        "$commissionAmount",
                        0,
                      ],
                    },
                  },
                  paidCommission: {
                    $sum: {
                      $cond: [
                        { $eq: ["$earningStatus", "paid"] },
                        "$commissionAmount",
                        0,
                      ],
                    },
                  },
                  totalCases: { $sum: 1 },
                  paidCases: {
                    $sum: {
                      $cond: [{ $eq: ["$earningStatus", "paid"] }, 1, 0],
                    },
                  },
                },
              },
            ],
            as: "commissionStats",
          },
        },
        {
          $unwind: {
            path: "$parentAgencyData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            commissionStats: {
              $ifNull: [
                { $arrayElemAt: ["$commissionStats", 0] },
                {
                  totalCommission: 0,
                  earnedCommission: 0,
                  paidCommission: 0,
                  totalCases: 0,
                  paidCases: 0,
                },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            mobile: 1,
            role: 1,
            status: 1,
            parentAgency: 1,
            parentAgencyName: "$parentAgencyData.name",
            agreedToTerms: 1,
            privacyPolicyAccepted: 1,
            isEmailVerified: 1,
            isMobileVerified: 1,
            createdAt: 1,
            updatedAt: 1,
            totalCommission: "$commissionStats.totalCommission",
            earnedCommission: "$commissionStats.earnedCommission",
            paidCommission: "$commissionStats.paidCommission",
            totalCommissionCases: "$commissionStats.totalCases",
            paidCommissionCases: "$commissionStats.paidCases",
            pendingCommissionCases: {
              $subtract: [
                "$commissionStats.totalCases",
                "$commissionStats.paidCases",
              ],
            },
          },
        },
      ];

      const result = await agencyService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channels fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agencyService.getById(req.params.id, {
        path: "parentAgency",
        select: "name email mobile status",
      });
      if (!result) {
        return res.status(404).json(new ApiError(404, "Channel not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizeAgencyUpdatePayload(req.body);
      if (!Object.keys(payload).length) {
        return res
          .status(400)
          .json(new ApiError(400, "No valid fields provided to update"));
      }

      const nextRole = payload.role;
      if (nextRole === "agency_member" && !payload.parentAgency) {
        const current = await Agency.findById(req.params.id).select("parentAgency");
        if (!current?.parentAgency) {
          return res
            .status(400)
            .json(new ApiError(400, "Parent agency is required for agency member"));
        }
      }

      if (payload.parentAgency) {
        if (String(payload.parentAgency) === String(req.params.id)) {
          return res
            .status(400)
            .json(new ApiError(400, "Parent agency cannot be the same channel"));
        }
        const parent = await Agency.findById(payload.parentAgency).select("_id");
        if (!parent) {
          return res.status(404).json(new ApiError(404, "Parent agency not found"));
        }
      }

      const result = await agencyService.updateById(req.params.id, payload);
      if (!result) {
        return res.status(404).json(new ApiError(404, "Channel not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = normalizeStatus(req.body?.status);
      if (!status) {
        return res.status(400).json(new ApiError(400, "Invalid status"));
      }

      const result = await agencyService.updateById(req.params.id, { status });
      if (!result) {
        return res.status(404).json(new ApiError(404, "Channel not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel status updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getEarnings(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const tabRaw = String(req.query?.tab || "earned").toLowerCase();
      const tab = tabRaw === "paid" ? "paid" : tabRaw === "projected" ? "projected" : "earned";
      const from = typeof req.query?.from === "string" ? req.query.from : undefined;
      const to = typeof req.query?.to === "string" ? req.query.to : undefined;
      const page = Number(req.query?.page) || 1;
      const limit = Number(req.query?.limit) || 20;
      const result = await agencyEarningsService.getAgencyEarningsForAdmin({
        agencyId: id,
        tab,
        from,
        to,
        page,
        limit,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel earnings fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async markEarningPaid(req: Request | any, res: Response, next: NextFunction) {
    try {
      const transactionId = req.params.transactionId;
      const adminId = req.user?._id;
      const paymentReference = req.body?.paymentReference;
      const notes = req.body?.notes;

      const transaction = await agencyEarningsService.markCommissionPaid({
        transactionId,
        paymentReference,
        notes,
        adminId,
      });

      return res
        .status(200)
        .json(new ApiResponse(200, transaction, "Commission marked as paid"));
    } catch (error) {
      next(error);
    }
  }

  static async listCommissionTransactions(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { agencyId, status, page = "1", limit = "20" } = req.query;
      const filter: Record<string, any> = {};
      if (typeof agencyId === "string" && agencyId.trim()) {
        filter.ownerAgency = agencyId.trim();
      }
      if (
        typeof status === "string" &&
        ["earned", "paid"].includes(status.trim())
      ) {
        filter.earningStatus = status.trim();
      }

      const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;

      const [result, total] = await Promise.all([
        AgencyCommissionTransaction.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .populate("ownerAgency", "name mobile email role")
          .populate("sourceAgency", "name mobile email role")
          .lean(),
        AgencyCommissionTransaction.countDocuments(filter),
      ]);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            result,
            pagination: {
              totalItems: total,
              totalPages: Math.ceil(total / limitNum) || 1,
              currentPage: pageNum,
              itemsPerPage: limitNum,
            },
          },
          "Commission transactions fetched successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}
