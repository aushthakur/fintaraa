import { Types } from "mongoose";
import { Agency } from "../modals/agency.model";
import ApiError from "../utils/ApiError";
import { LoanQuery } from "../modals/loanquery.model";
import { normalizeLoanType } from "../utils/loanType";
import { ApplicationStatus } from "../modals/insurancequery.model";
import { AgencyCommissionTransaction } from "../modals/agencyCommissionTransaction.model";
import { agencyEarningsService } from "./agencyEarnings.service";

type LeadStage = "all" | "pre_login" | "login" | "sanction" | "disbursed";

const LOGIN_STATUSES = [
  ApplicationStatus.PENDING,
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.IN_PROGRESS,
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.DOCUMENT_VERIFICATION,
  ApplicationStatus.ACTIVE,
];

const SANCTION_STATUSES = [ApplicationStatus.APPROVED];
const DISBURSED_STATUSES = [
  ApplicationStatus.DISBURSED,
  ApplicationStatus.COMPLETED,
];
const PRE_LOGIN_STATUSES = [ApplicationStatus.DRAFT];

const toNumber = (value: any) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const stringifyId = (value: any): string => {
  if (value === null || value === undefined) return "";
  const visited = new Set<any>();
  let current: any = value;

  while (current !== null && current !== undefined) {
    if (typeof current === "string") return current;
    if (typeof current === "number" || typeof current === "bigint") {
      return String(current);
    }
    if (current instanceof Types.ObjectId) return current.toString();
    if (typeof current === "object") {
      if (visited.has(current)) return "";
      visited.add(current);
      if (typeof current.toHexString === "function") {
        return current.toHexString();
      }
      if (current._id && current._id !== current) {
        current = current._id;
        continue;
      }
      if (typeof current.id === "string" && current.id) return current.id;
    }
    return String(current);
  }

  return "";
};

const toObjectId = (value: string) =>
  Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;

const statusFilterForStage = (stage: LeadStage) => {
  if (stage === "pre_login") return { $in: PRE_LOGIN_STATUSES };
  if (stage === "login") return { $in: LOGIN_STATUSES };
  if (stage === "sanction") return { $in: SANCTION_STATUSES };
  if (stage === "disbursed") return { $in: DISBURSED_STATUSES };
  return undefined;
};

export class AgencyLeadsService {
  private async getScope(agencyId: string) {
    const current = await Agency.findById(agencyId)
      .select("_id role parentAgency")
      .lean();
    if (!current) throw new ApiError(404, "Agency not found");

    const ownerAgencyId = stringifyId(current.parentAgency || current._id);
    const ownerObjectId = toObjectId(ownerAgencyId);
    if (!ownerObjectId) throw new ApiError(400, "Invalid agency scope");

    const memberIds = await Agency.find({ parentAgency: ownerObjectId })
      .distinct("_id")
      .then((ids) => ids.map((id) => stringifyId(id)));

    const scopeIds = Array.from(new Set([ownerAgencyId, ...memberIds]));
    const scopeObjectIds = scopeIds
      .map((id) => toObjectId(id))
      .filter((id): id is Types.ObjectId => Boolean(id));

    return {
      ownerAgencyId,
      ownerObjectId,
      scopeObjectIds,
    };
  }

  private buildOwnershipFilter(
    ownerObjectId: Types.ObjectId,
    scopeObjectIds: Types.ObjectId[],
  ) {
    return {
      $or: [
        { ownerAgency: ownerObjectId },
        {
          ownerAgency: { $exists: false },
          customerId: { $in: scopeObjectIds },
        },
      ],
    };
  }

  async getLeadSummary(agencyId: string) {
    const scope = await this.getScope(agencyId);
    const ownership = this.buildOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );

    const [statusAgg, loanTypeAgg, commissionAgg] = await Promise.all([
      LoanQuery.aggregate([
        { $match: ownership },
        {
          $group: {
            _id: null,
            totalLeads: { $sum: 1 },
            potentialValue: {
              $sum: {
                $cond: [
                  { $in: ["$status", DISBURSED_STATUSES] },
                  0,
                  { $ifNull: ["$loanAmount", 0] },
                ],
              },
            },
            stagePreLogin: {
              $sum: {
                $cond: [{ $in: ["$status", PRE_LOGIN_STATUSES] }, 1, 0],
              },
            },
            stageLogin: {
              $sum: {
                $cond: [{ $in: ["$status", LOGIN_STATUSES] }, 1, 0],
              },
            },
            stageSanction: {
              $sum: {
                $cond: [{ $in: ["$status", SANCTION_STATUSES] }, 1, 0],
              },
            },
            stageDisbursed: {
              $sum: {
                $cond: [{ $in: ["$status", DISBURSED_STATUSES] }, 1, 0],
              },
            },
          },
        },
      ]),
      LoanQuery.aggregate([
        { $match: ownership },
        {
          $group: {
            _id: "$loanType",
            count: { $sum: 1 },
            totalAmount: { $sum: { $ifNull: ["$loanAmount", 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),
      AgencyCommissionTransaction.aggregate([
        {
          $match: {
            ownerAgency: scope.ownerObjectId,
            queryType: "loan",
          },
        },
        {
          $group: {
            _id: "$loanType",
            disbursedCases: { $sum: 1 },
            disbursedAmount: { $sum: { $ifNull: ["$disbursedAmount", 0] } },
            totalCommission: { $sum: { $ifNull: ["$commissionAmount", 0] } },
            earnedCommission: {
              $sum: {
                $cond: [
                  { $eq: ["$earningStatus", "earned"] },
                  { $ifNull: ["$commissionAmount", 0] },
                  0,
                ],
              },
            },
            paidCommission: {
              $sum: {
                $cond: [
                  { $eq: ["$earningStatus", "paid"] },
                  { $ifNull: ["$commissionAmount", 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const status = statusAgg?.[0] || {};
    const commissionMap = new Map<string, any>(
      (commissionAgg || []).map((row: any) => [String(row?._id || ""), row]),
    );

    const loanTypeBreakdown = (loanTypeAgg || []).map((row: any) => {
      const key = String(row?._id || "");
      const commission = commissionMap.get(key) || {};
      return {
        loanType: key,
        count: Number(row?.count || 0),
        totalAmount: Number(row?.totalAmount || 0),
        disbursedCases: Number(commission?.disbursedCases || 0),
        disbursedAmount: Number(commission?.disbursedAmount || 0),
        totalCommission: Number(commission?.totalCommission || 0),
        earnedCommission: Number(commission?.earnedCommission || 0),
        paidCommission: Number(commission?.paidCommission || 0),
      };
    });

    const commissionTotals = (commissionAgg || []).reduce(
      (acc: any, row: any) => {
        acc.disbursedCases += Number(row?.disbursedCases || 0);
        acc.disbursedValue += Number(row?.disbursedAmount || 0);
        acc.totalCommission += Number(row?.totalCommission || 0);
        acc.earnedCommission += Number(row?.earnedCommission || 0);
        acc.paidCommission += Number(row?.paidCommission || 0);
        return acc;
      },
      {
        disbursedCases: 0,
        disbursedValue: 0,
        totalCommission: 0,
        earnedCommission: 0,
        paidCommission: 0,
      },
    );

    return {
      ownerAgencyId: scope.ownerAgencyId,
      summary: {
        totalLeads: Number(status.totalLeads || 0),
        activePipelineCount:
          Number(status.totalLeads || 0) - Number(status.stageDisbursed || 0),
        potentialValue: Number(status.potentialValue || 0),
        disbursedCases: commissionTotals.disbursedCases,
        disbursedValue: commissionTotals.disbursedValue,
        totalCommission: commissionTotals.totalCommission,
        earnedCommission: commissionTotals.earnedCommission,
        paidCommission: commissionTotals.paidCommission,
        pendingCommission:
          commissionTotals.totalCommission - commissionTotals.paidCommission,
      },
      stageCounts: {
        preLogin: Number(status.stagePreLogin || 0),
        login: Number(status.stageLogin || 0),
        sanction: Number(status.stageSanction || 0),
        disbursed: Number(status.stageDisbursed || 0),
      },
      loanTypeBreakdown,
    };
  }

  async listLeads(input: {
    agencyId: string;
    stage?: LeadStage;
    loanType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const scope = await this.getScope(input.agencyId);
    const page = Math.max(Number(input.page) || 1, 1);
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = this.buildOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );
    const stage = (input.stage || "all") as LeadStage;
    const stageFilter = statusFilterForStage(stage);
    if (stageFilter) {
      filter.status = stageFilter;
    }

    const normalizedLoanType = normalizeLoanType(input.loanType);
    if (normalizedLoanType) filter.loanType = normalizedLoanType;

    const search = String(input.search || "").trim();
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$and = [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        {
          $or: [
            { firstName: regex },
            { lastName: regex },
            { mobile: regex },
            { loanId: regex },
          ],
        },
      ];
    }

    const [totalItems, rows] = await Promise.all([
      LoanQuery.countDocuments(filter),
      LoanQuery.find(filter)
        .select(
          "_id loanId firstName lastName mobile status loanType loanAmount createdAt updatedAt policyDetails assignedAgent assignedLander",
        )
        .populate("assignedAgent", "name username email mobile")
        .populate("assignedLander", "name email mobile")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const queryIds = rows
      .map((item: any) => stringifyId(item._id))
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const commissionRows = queryIds.length
      ? await AgencyCommissionTransaction.find({
          ownerAgency: scope.ownerObjectId,
          queryType: "loan",
          queryRef: { $in: queryIds },
        })
          .select(
            "_id queryRef commissionAmount earningStatus paidAt paymentReference disbursedAmount",
          )
          .lean()
      : [];
    const commissionMap = new Map<string, any>(
      commissionRows.map((item: any) => [stringifyId(item.queryRef), item]),
    );

    const result = await Promise.all(
      rows.map(async (query: any) => {
        const queryId = stringifyId(query._id);
        const commission = commissionMap.get(queryId);
        let projectedCommission = 0;

        if (!commission) {
          try {
            const estimated = await agencyEarningsService.estimateLoanCommission(
              query,
            );
            projectedCommission = Number(estimated?.commissionAmount || 0);
          } catch {
            projectedCommission = 0;
          }
        }

        return {
          id: queryId,
          loanId: query.loanId || queryId,
          customerName: `${query.firstName || ""} ${query.lastName || ""}`.trim(),
          mobile: query.mobile,
          loanType: query.loanType,
          status: query.status,
          loanAmount: toNumber(query.loanAmount),
          createdAt: query.createdAt,
          updatedAt: query.updatedAt,
          assignedAgentName:
            query?.assignedAgent?.name || query?.assignedAgent?.username,
          assignedLanderName: query?.assignedLander?.name,
          commissionStatus: commission
            ? commission.earningStatus
            : projectedCommission > 0
              ? "projected"
              : "none",
          commissionAmount: commission
            ? toNumber(commission.commissionAmount)
            : projectedCommission,
          disbursedAmount: commission ? toNumber(commission.disbursedAmount) : 0,
          paidAt: commission?.paidAt,
          paymentReference: commission?.paymentReference,
        };
      }),
    );

    return {
      result,
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
        itemsPerPage: limit,
      },
    };
  }
}

export const agencyLeadsService = new AgencyLeadsService();

