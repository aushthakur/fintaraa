import { Types } from "mongoose";
import { Agency } from "../modals/agency.model";
import ApiError from "../utils/ApiError";
import { LoanQuery } from "../modals/loanquery.model";
import { normalizeLoanType } from "../utils/loanType";
import {
  ApplicationStatus,
  InsuranceQuery,
  InsuranceType,
} from "../modals/insurancequery.model";
import { AgencyCommissionTransaction } from "../modals/agencyCommissionTransaction.model";
import { agencyEarningsService } from "./agencyEarnings.service";

type LeadStage = "all" | "pre_login" | "login" | "sanction" | "disbursed";
type ProductFilter = "all" | "loan" | "credit_card" | "insurance";

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

const INSURANCE_TYPE_SET = new Set<string>(
  Object.values(InsuranceType).map((value) => String(value).toLowerCase()),
);

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

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const statusFilterForStage = (stage: LeadStage) => {
  if (stage === "pre_login") return { $in: PRE_LOGIN_STATUSES };
  if (stage === "login") return { $in: LOGIN_STATUSES };
  if (stage === "sanction") return { $in: SANCTION_STATUSES };
  if (stage === "disbursed") return { $in: DISBURSED_STATUSES };
  return undefined;
};

const normalizeProductFilter = (value?: string): ProductFilter => {
  const normalized = String(value || "all").trim().toLowerCase();
  if (normalized === "loan" || normalized === "loans") return "loan";
  if (normalized === "credit_card" || normalized === "credit card") {
    return "credit_card";
  }
  if (
    ["insurance", "insurances", "policy", "policies"].includes(normalized)
  ) {
    return "insurance";
  }
  return "all";
};

const statusFilterForSelection = (value?: string) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "all") return undefined;
  if (normalized === "pending") {
    return {
      $in: [
        ApplicationStatus.PENDING,
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.IN_PROGRESS,
      ],
    };
  }
  if (normalized === "under_review") {
    return {
      $in: [
        ApplicationStatus.UNDER_REVIEW,
        ApplicationStatus.DOCUMENT_VERIFICATION,
      ],
    };
  }
  if (normalized === "approved") {
    return {
      $in: [ApplicationStatus.APPROVED, ApplicationStatus.DISBURSED],
    };
  }

  const supported = new Set<string>([
    ApplicationStatus.ACTIVE,
    ApplicationStatus.COMPLETED,
    ApplicationStatus.CANCELLED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.DRAFT,
  ]);
  return supported.has(normalized) ? { $in: [normalized] } : undefined;
};

const appendAndFilter = (
  target: Record<string, any>,
  condition?: Record<string, any>,
) => {
  if (!condition) return;
  target.$and = [
    ...(Array.isArray(target.$and) ? target.$and : []),
    condition,
  ];
};

const buildAmountFilter = (
  fieldPaths: string[],
  minAmount?: number,
  maxAmount?: number,
) => {
  const min = Number(minAmount);
  const max = Number(maxAmount);
  const hasMin = Number.isFinite(min) && min >= 0;
  const hasMax = Number.isFinite(max) && max >= 0;
  if (!hasMin && !hasMax) return undefined;

  const numericAmount = {
    $max: fieldPaths.map((fieldPath) => ({
      $convert: {
        input: `$${fieldPath}`,
        to: "double",
        onError: 0,
        onNull: 0,
      },
    })),
  };
  const comparisons = [
    ...(hasMin ? [{ $gte: [numericAmount, min] }] : []),
    ...(hasMax ? [{ $lte: [numericAmount, max] }] : []),
  ];

  return {
    $expr:
      comparisons.length === 1 ? comparisons[0] : { $and: comparisons },
  };
};

const normalizeInsuranceTypeFilter = (value?: string): string | undefined => {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  const withoutPrefix = normalized.startsWith("insurance_")
    ? normalized.slice("insurance_".length)
    : normalized;
  const compact = withoutPrefix.replace(/[\s-]+/g, "_");
  if (INSURANCE_TYPE_SET.has(compact)) return compact;
  return undefined;
};

const getInsuranceAmount = (query: any) => {
  const details = query?.policyDetails || {};
  const candidates = [
    details.sumInsured,
    details.sumAssured,
    details.coverageRequired,
    details.propertyValue,
    details.averageMonthlyStockValue,
    details.currentMarketValue,
    details.monthlyTurnover,
    query?.annualIncome,
  ];
  for (const value of candidates) {
    const amount = toNumber(value);
    if (amount > 0) return amount;
  }
  return 0;
};

const sortByUpdatedAtDesc = (a: any, b: any) => {
  const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
  const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
  return bTime - aTime;
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

  private buildLoanOwnershipFilter(
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

  private buildInsuranceOwnershipFilter(
    ownerObjectId: Types.ObjectId,
    scopeObjectIds: Types.ObjectId[],
  ) {
    return {
      $or: [
        { ownerAgency: ownerObjectId },
        {
          ownerAgency: { $exists: false },
          channelAgency: { $in: scopeObjectIds },
        },
        {
          ownerAgency: { $exists: false },
          customerId: { $in: scopeObjectIds },
        },
      ],
    };
  }

  async getLeadSummary(agencyId: string) {
    const scope = await this.getScope(agencyId);
    const loanOwnership = this.buildLoanOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );
    const insuranceOwnership = this.buildInsuranceOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );

    const [loanStatusAgg, insuranceStatusAgg, loanTypeAgg, insuranceTypeAgg, commissionAgg] =
      await Promise.all([
        LoanQuery.aggregate([
          { $match: loanOwnership },
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
        InsuranceQuery.aggregate([
          { $match: insuranceOwnership },
          {
            $group: {
              _id: null,
              totalLeads: { $sum: 1 },
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
          { $match: loanOwnership },
          {
            $group: {
              _id: "$loanType",
              count: { $sum: 1 },
              totalAmount: { $sum: { $ifNull: ["$loanAmount", 0] } },
            },
          },
          { $sort: { count: -1 } },
        ]),
        InsuranceQuery.aggregate([
          { $match: insuranceOwnership },
          {
            $group: {
              _id: "$typeOfInsurance",
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        AgencyCommissionTransaction.aggregate([
          {
            $match: {
              ownerAgency: scope.ownerObjectId,
              queryType: { $in: ["loan", "insurance"] },
            },
          },
          {
            $group: {
              _id: {
                queryType: "$queryType",
                loanType: "$loanType",
                insuranceType: "$insuranceType",
              },
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

    const loanStatus = loanStatusAgg?.[0] || {};
    const insuranceStatus = insuranceStatusAgg?.[0] || {};
    const commissionMap = new Map<string, any>();
    (commissionAgg || []).forEach((row: any) => {
      const key =
        row?._id?.queryType === "insurance"
          ? `insurance:${String(row?._id?.insuranceType || "")}`
          : `loan:${String(row?._id?.loanType || "")}`;
      commissionMap.set(key, row);
    });

    const loanBreakdown = (loanTypeAgg || []).map((row: any) => {
      const key = String(row?._id || "");
      const commission = commissionMap.get(`loan:${key}`) || {};
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

    const insuranceBreakdown = (insuranceTypeAgg || []).map((row: any) => {
      const insuranceType = String(row?._id || "");
      const commission = commissionMap.get(`insurance:${insuranceType}`) || {};
      return {
        loanType: `insurance_${insuranceType}`,
        count: Number(row?.count || 0),
        totalAmount: 0,
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

    const totalLeads =
      Number(loanStatus.totalLeads || 0) + Number(insuranceStatus.totalLeads || 0);
    const stageDisbursed =
      Number(loanStatus.stageDisbursed || 0) +
      Number(insuranceStatus.stageDisbursed || 0);

    return {
      ownerAgencyId: scope.ownerAgencyId,
      summary: {
        totalLeads,
        activePipelineCount: totalLeads - stageDisbursed,
        potentialValue: Number(loanStatus.potentialValue || 0),
        disbursedCases: commissionTotals.disbursedCases,
        disbursedValue: commissionTotals.disbursedValue,
        totalCommission: commissionTotals.totalCommission,
        earnedCommission: commissionTotals.earnedCommission,
        paidCommission: commissionTotals.paidCommission,
        pendingCommission:
          commissionTotals.totalCommission - commissionTotals.paidCommission,
      },
      stageCounts: {
        preLogin:
          Number(loanStatus.stagePreLogin || 0) +
          Number(insuranceStatus.stagePreLogin || 0),
        login:
          Number(loanStatus.stageLogin || 0) +
          Number(insuranceStatus.stageLogin || 0),
        sanction:
          Number(loanStatus.stageSanction || 0) +
          Number(insuranceStatus.stageSanction || 0),
        disbursed: stageDisbursed,
      },
      loanTypeBreakdown: [...loanBreakdown, ...insuranceBreakdown].sort(
        (a, b) => Number(b.count || 0) - Number(a.count || 0),
      ),
    };
  }

  async listLeads(input: {
    agencyId: string;
    stage?: LeadStage;
    productType?: string;
    loanType?: string;
    status?: string;
    search?: string;
    minAmount?: number;
    maxAmount?: number;
    page?: number;
    limit?: number;
  }) {
    const scope = await this.getScope(input.agencyId);
    const page = Math.max(Number(input.page) || 1, 1);
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const productType = normalizeProductFilter(input.productType);

    const stage = (input.stage || "all") as LeadStage;
    const stageFilter = statusFilterForStage(stage);
    const statusFilter = statusFilterForSelection(input.status);
    const search = String(input.search || "").trim();
    const regex = search ? new RegExp(escapeRegex(search), "i") : null;
    const normalizedLoanType = normalizeLoanType(input.loanType);
    const normalizedInsuranceType = normalizeInsuranceTypeFilter(input.loanType);

    const loanFilter: Record<string, any> = this.buildLoanOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );
    if (stageFilter) appendAndFilter(loanFilter, { status: stageFilter });
    if (statusFilter) appendAndFilter(loanFilter, { status: statusFilter });
    if (productType === "credit_card") {
      loanFilter.loanType = "credit_card";
    } else if (normalizedLoanType) {
      loanFilter.loanType = normalizedLoanType;
    } else if (productType === "loan") {
      loanFilter.loanType = { $ne: "credit_card" };
    }
    appendAndFilter(
      loanFilter,
      buildAmountFilter(
        ["loanAmount", "policyDetails.loanAmount"],
        input.minAmount,
        input.maxAmount,
      ),
    );
    if (regex) {
      appendAndFilter(loanFilter, {
        $or: [
          { firstName: regex },
          { lastName: regex },
          { mobile: regex },
          { loanId: regex },
          { loanType: regex },
        ],
      });
    }

    const insuranceFilter: Record<string, any> = this.buildInsuranceOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );
    if (stageFilter) appendAndFilter(insuranceFilter, { status: stageFilter });
    if (statusFilter) {
      appendAndFilter(insuranceFilter, { status: statusFilter });
    }
    if (normalizedInsuranceType) insuranceFilter.typeOfInsurance = normalizedInsuranceType;
    appendAndFilter(
      insuranceFilter,
      buildAmountFilter(
        [
          "policyDetails.sumInsured",
          "policyDetails.sumAssured",
          "policyDetails.coverageRequired",
          "policyDetails.propertyValue",
          "policyDetails.averageMonthlyStockValue",
          "policyDetails.currentMarketValue",
          "policyDetails.monthlyTurnover",
          "annualIncome",
        ],
        input.minAmount,
        input.maxAmount,
      ),
    );
    if (regex) {
      appendAndFilter(insuranceFilter, {
        $or: [
          { firstName: regex },
          { lastName: regex },
          { mobile: regex },
          { email: regex },
          { typeOfInsurance: regex },
        ],
      });
    }

    const shouldLoadLoans =
      productType === "loan" ||
      productType === "credit_card" ||
      (productType === "all" && !normalizedInsuranceType);
    const shouldLoadInsurance =
      productType === "insurance" ||
      (productType === "all" && !normalizedLoanType);

    const unionTarget = page * limit;

    const [loanTotal, insuranceTotal, loanRowsRaw, insuranceRowsRaw] = await Promise.all([
      shouldLoadLoans ? LoanQuery.countDocuments(loanFilter) : 0,
      shouldLoadInsurance ? InsuranceQuery.countDocuments(insuranceFilter) : 0,
      shouldLoadLoans
        ? LoanQuery.find(loanFilter)
            .select(
              "_id loanId firstName lastName mobile status loanType loanAmount createdAt updatedAt policyDetails assignedAgent assignedLander",
            )
            .populate("assignedAgent", "name username email mobile")
            .populate("assignedLander", "name email mobile")
            .sort({ updatedAt: -1 })
            .skip(productType !== "all" ? skip : 0)
            .limit(productType !== "all" ? limit : unionTarget)
            .lean()
        : [],
      shouldLoadInsurance
        ? InsuranceQuery.find(insuranceFilter)
            .select(
              "_id firstName lastName mobile email status typeOfInsurance annualIncome policyDetails createdAt updatedAt assignedAgent assignedLander",
            )
            .populate("assignedAgent", "name username email mobile")
            .populate("assignedLander", "name email mobile")
            .sort({ updatedAt: -1 })
            .skip(productType === "insurance" ? skip : 0)
            .limit(productType === "insurance" ? limit : unionTarget)
            .lean()
        : [],
    ]);

    const allRowsRaw = [
      ...loanRowsRaw.map((item: any) => ({ ...item, __queryType: "loan" })),
      ...insuranceRowsRaw.map((item: any) => ({
        ...item,
        __queryType: "insurance",
      })),
    ];
    const rows =
      productType === "all"
        ? allRowsRaw.sort(sortByUpdatedAtDesc).slice(skip, skip + limit)
        : allRowsRaw;

    const idsByType = rows.reduce(
      (acc: any, item: any) => {
        const id = stringifyId(item?._id);
        if (!Types.ObjectId.isValid(id)) return acc;
        if (item.__queryType === "insurance") {
          acc.insurance.push(new Types.ObjectId(id));
        } else {
          acc.loan.push(new Types.ObjectId(id));
        }
        return acc;
      },
      { loan: [] as Types.ObjectId[], insurance: [] as Types.ObjectId[] },
    );

    const commissionFilters = [
      ...(idsByType.loan.length
        ? [{ queryType: "loan", queryRef: { $in: idsByType.loan } }]
        : []),
      ...(idsByType.insurance.length
        ? [{ queryType: "insurance", queryRef: { $in: idsByType.insurance } }]
        : []),
    ];
    const commissionRows = commissionFilters.length
      ? await AgencyCommissionTransaction.find({
          ownerAgency: scope.ownerObjectId,
          $or: commissionFilters,
        })
          .select(
            "_id queryType queryRef commissionAmount earningStatus paidAt paymentReference disbursedAmount",
          )
          .lean()
      : [];
    const commissionMap = new Map<string, any>(
      commissionRows.map((item: any) => [
        `${item.queryType}:${stringifyId(item.queryRef)}`,
        item,
      ]),
    );

    const result = await Promise.all(
      rows.map(async (query: any) => {
        const queryId = stringifyId(query._id);
        const queryType = query.__queryType === "insurance" ? "insurance" : "loan";
        const commission = commissionMap.get(`${queryType}:${queryId}`);

        if (queryType === "insurance") {
          const insuranceType = String(query.typeOfInsurance || "policy")
            .toLowerCase()
            .trim();
          return {
            id: queryId,
            loanId: queryId,
            customerName: `${query.firstName || ""} ${query.lastName || ""}`.trim(),
            mobile: query.mobile,
            loanType: `insurance_${insuranceType}`,
            status: query.status,
            loanAmount: getInsuranceAmount(query),
            createdAt: query.createdAt,
            updatedAt: query.updatedAt,
            assignedAgentName:
              query?.assignedAgent?.name || query?.assignedAgent?.username,
            assignedLanderName: query?.assignedLander?.name,
            commissionStatus: commission ? commission.earningStatus : "none",
            commissionAmount: commission ? toNumber(commission.commissionAmount) : 0,
            disbursedAmount: commission ? toNumber(commission.disbursedAmount) : 0,
            paidAt: commission?.paidAt,
            paymentReference: commission?.paymentReference,
            productType: "insurance",
          };
        }

        let projectedCommission = 0;
        if (!commission) {
          try {
            const estimated = await agencyEarningsService.estimateLoanCommission(query);
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
          productType: "loan",
        };
      }),
    );

    const totalItems = loanTotal + insuranceTotal;
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
