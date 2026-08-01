import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Contest } from "../../modals/contest.model";
import { Agency } from "../../modals/agency.model";
import { Types } from "mongoose";
import { AgencyCommissionTransaction } from "../../modals/agencyCommissionTransaction.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { AgencyContestEnrollment } from "../../modals/agencyContestEnrollment.model";

const ContestService = new CommonService(Contest);
const isAgencyRole = (role?: string) =>
  role === "agency" || role === "agency_member";

const parseTargetAmount = (label?: string) => {
  if (!label) return 0;
  const normalized = String(label).toLowerCase().replace(/,/g, "").trim();
  const match = normalized.match(/(\d+(\.\d+)?)/);
  if (!match) return 0;
  const base = Number(match[1] || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (/\bcr|crore/.test(normalized)) return base * 10000000;
  if (/\blac|lakh/.test(normalized)) return base * 100000;
  if (/\bk\b/.test(normalized)) return base * 1000;
  return base;
};

const formatAmountCompact = (value: number) => {
  const amount = Number(value || 0);
  if (amount <= 0) return "0";
  if (amount >= 10000000) {
    const cr = amount / 10000000;
    return `${Number(cr.toFixed(2)).toString()} Cr`;
  }
  if (amount >= 100000) {
    const lakh = amount / 100000;
    return `${Number(lakh.toFixed(2)).toString()} Lakh`;
  }
  return amount.toLocaleString("en-IN");
};

const getTrackingWindow = (
  contest: any,
  activatedAt?: Date,
): { from?: Date; to?: Date } => {
  const now = new Date();
  const fromCandidates = [contest?.validFrom, activatedAt]
    .filter(Boolean)
    .map((value) => new Date(String(value)));
  const toCandidates = [contest?.validTo, now]
    .filter(Boolean)
    .map((value) => new Date(String(value)));

  const from =
    fromCandidates.length > 0
      ? new Date(Math.max(...fromCandidates.map((d) => d.getTime())))
      : undefined;
  const to =
    toCandidates.length > 0
      ? new Date(Math.min(...toCandidates.map((d) => d.getTime())))
      : undefined;

  if (from && to && from.getTime() > to.getTime()) return { from, to: from };
  return { from, to };
};

export class ContestController {
  private static async resolveOwnerAgencyId(req: Request | any) {
    const currentUserId = req.user?._id;
    const role = req.user?.role;

    if (!currentUserId || !isAgencyRole(role)) {
      throw new ApiError(403, "Only agencies can access contest assignment");
    }

    if (role === "agency_member") {
      const agency = await Agency.findById(currentUserId)
        .select("parentAgency")
        .lean();
      const parentAgencyId = agency?.parentAgency
        ? String(agency.parentAgency)
        : "";
      if (!parentAgencyId || !Types.ObjectId.isValid(parentAgencyId)) {
        throw new ApiError(
          400,
          "Agency member is not linked to a valid parent agency",
        );
      }
      return parentAgencyId;
    }

    return String(currentUserId);
  }

  static async applyContest(req: Request | any, res: Response, next: NextFunction) {
    try {
      const ownerAgencyId = await ContestController.resolveOwnerAgencyId(req);
      const actorId = req.user?._id;
      const { id } = req.params;

      if (!Types.ObjectId.isValid(id)) {
        return res.status(400).json(new ApiError(400, "Invalid contest id"));
      }

      const contest = await Contest.findById(id).lean();
      if (!contest) {
        return res.status(404).json(new ApiError(404, "Contest not found"));
      }
      if (contest.status !== "active") {
        return res.status(400).json(new ApiError(400, "Contest is not active"));
      }

      const now = new Date();
      if (contest.validFrom && new Date(contest.validFrom).getTime() > now.getTime()) {
        return res
          .status(400)
          .json(new ApiError(400, "Contest has not started yet"));
      }
      if (contest.validTo && new Date(contest.validTo).getTime() < now.getTime()) {
        return res.status(400).json(new ApiError(400, "Contest has ended"));
      }

      const activeEnrollment = await AgencyContestEnrollment.findOne({
        ownerAgency: ownerAgencyId,
        status: "active",
      })
        .populate("contest")
        .lean();

      if (activeEnrollment) {
        if (String(activeEnrollment.contest?._id || activeEnrollment.contest) === id) {
          return res
            .status(200)
            .json(
              new ApiResponse(
                200,
                activeEnrollment,
                "Contest target already active for this agency",
              ),
            );
        }
        return res.status(409).json(
          new ApiError(
            409,
            "You already have one active contest target. Complete it before selecting another.",
          ),
        );
      }

      const enrollment = await AgencyContestEnrollment.create({
        ownerAgency: ownerAgencyId,
        contest: id,
        status: "active",
        activatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });

      return res
        .status(201)
        .json(
          new ApiResponse(201, enrollment, "Contest target activated successfully"),
        );
    } catch (err) {
      next(err);
    }
  }

  static async getMyContestSummary(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const ownerAgencyId = await ContestController.resolveOwnerAgencyId(req);
      const enrollment = await AgencyContestEnrollment.findOne({
        ownerAgency: ownerAgencyId,
        status: "active",
      })
        .populate("contest")
        .lean();

      if (!enrollment?.contest) {
        return res.status(200).json(
          new ApiResponse(
            200,
            {
              hasActiveContest: false,
              activeContest: null,
              summary: {
                targetAmount: 0,
                achievedAmount: 0,
                remainingAmount: 0,
                progressPercent: 0,
                disbursedCases: 0,
                targetLabel: "0",
                achievedLabel: "0",
                remainingLabel: "0",
              },
            },
            "Contest summary fetched successfully",
          ),
        );
      }

      const contest: any = enrollment.contest;
      const { from, to } = getTrackingWindow(contest, enrollment.activatedAt);
      const disbursedAtFilter: Record<string, any> = {};
      if (from) disbursedAtFilter.$gte = from;
      if (to) disbursedAtFilter.$lte = to;

      const match: Record<string, any> = {
        ownerAgency: new Types.ObjectId(ownerAgencyId),
        queryType: "loan",
        isCanonical: { $ne: false },
      };
      if (Object.keys(disbursedAtFilter).length) {
        match.disbursedAt = disbursedAtFilter;
      }

      const aggregate = await AgencyCommissionTransaction.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            achievedAmount: { $sum: "$disbursedAmount" },
            disbursedCases: { $sum: 1 },
          },
        },
      ]);

      const achievedAmount = Number(aggregate?.[0]?.achievedAmount || 0);
      const disbursedCases = Number(aggregate?.[0]?.disbursedCases || 0);
      const targetAmount =
        Number((contest as any)?.targetAmount || 0) ||
        parseTargetAmount(contest?.targetLabel);
      const remainingAmount = Math.max(targetAmount - achievedAmount, 0);
      const progressPercent =
        targetAmount > 0
          ? Math.min(100, Number(((achievedAmount / targetAmount) * 100).toFixed(2)))
          : 0;

      const payload = {
        hasActiveContest: true,
        activeContest: {
          id: String(contest._id),
          title: contest.title,
          targetLabel: contest.targetLabel,
          periodLabel: contest.periodLabel,
          validFrom: contest.validFrom,
          validTo: contest.validTo,
          activatedAt: enrollment.activatedAt,
        },
        summary: {
          targetAmount,
          achievedAmount,
          remainingAmount,
          progressPercent,
          disbursedCases,
          targetLabel: contest.targetLabel || formatAmountCompact(targetAmount),
          achievedLabel: formatAmountCompact(achievedAmount),
          remainingLabel: formatAmountCompact(remainingAmount),
          trackedFrom: from,
          trackedTo: to,
        },
      };

      return res
        .status(200)
        .json(new ApiResponse(200, payload, "Contest summary fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createContest(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ContestService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create contest"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllContests(req: Request, res: Response, next: NextFunction) {
    try {
      const { role, _id } = (req as any).user;
      const result = await ContestService.getAll({
        ...req.query,
        ...(role === "admin" ? {} : { status: "active" }),
      });

      if (isAgencyRole(role)) {
        const ownerAgencyId =
          role === "agency_member"
            ? String(
                (await Agency.findById(_id).select("parentAgency").lean())
                  ?.parentAgency || "",
              )
            : String(_id);

        if (Types.ObjectId.isValid(ownerAgencyId)) {
          const activeEnrollment = await AgencyContestEnrollment.findOne({
            ownerAgency: ownerAgencyId,
            status: "active",
          })
            .select("contest")
            .lean();
          const activeContestId = String(activeEnrollment?.contest || "");

          const list = Array.isArray((result as any)?.result)
            ? (result as any).result
            : Array.isArray(result)
              ? result
              : [];

          if (Array.isArray(list) && activeContestId) {
            list.forEach((contest: any) => {
              contest.isMyActiveTarget =
                String(contest?._id || contest?.id) === activeContestId;
            });
          }
        }
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getContestById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ContestService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Contest not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateContestById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ContestService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update contest"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteContestById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ContestService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete contest"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
