import { Types } from "mongoose";
import { Agency } from "../modals/agency.model";
import ApiError from "../utils/ApiError";
import { ApplicationStatus } from "../modals/insurancequery.model";
import { LoanQuery } from "../modals/loanquery.model";
import { AgencyCommissionTransaction } from "../modals/agencyCommissionTransaction.model";
import {
  EligibilityCriteria,
  EligibilityCommissionType,
  EligibilityCriteriaStatus,
} from "../modals/eligibilityCriteria.model";

type TabKey = "projected" | "earned" | "paid";

const PROJECTED_EXCLUDED_STATUSES = [
  ApplicationStatus.DRAFT,
  ApplicationStatus.CANCELLED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.DISBURSED,
  ApplicationStatus.COMPLETED,
];

const toNumber = (value: any): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizedDate = (value?: string, endOfDay = false) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
};

const dateRangeFilter = (from?: string, to?: string) => {
  const start = normalizedDate(from, false);
  const end = normalizedDate(to, true);
  if (!start && !end) return undefined;
  return {
    ...(start ? { $gte: start } : {}),
    ...(end ? { $lte: end } : {}),
  };
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

const normalizeLookupValue = (value?: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const normalizeSalaryType = (value?: any) => {
  const key = normalizeLookupValue(value);
  if (!key) return "";
  if (["salaried", "salary"].includes(key)) return "salaried";
  if (
    [
      "selfemployedprofessional",
      "selfemployedpro",
      "selfprofessional",
      "selfemployed_professional",
    ].includes(key)
  ) {
    return "selfemployedprofessional";
  }
  if (
    [
      "selfemployednonprofessional",
      "selfemployednonpro",
      "selfnonprofessional",
      "selfemployed_non_professional",
      "selfemployed",
    ].includes(key)
  ) {
    return "selfemployednonprofessional";
  }
  return key;
};

export class AgencyEarningsService {
  private computeCommissionFromCriteria(criteria: any, disbursedAmount: number) {
    const amount = toNumber(disbursedAmount);
    const minAmount = toNumber(criteria?.commissionMinAmount);
    const maxAmount = toNumber(criteria?.commissionMaxAmount);
    const capAmount = toNumber(criteria?.commissionCapAmount);
    const commissionValue = toNumber(criteria?.commissionValue);
    const commissionType = String(
      criteria?.commissionType || EligibilityCommissionType.PERCENTAGE,
    ).toLowerCase();

    if (!amount || !commissionValue) return 0;
    if (minAmount && amount < minAmount) return 0;
    if (maxAmount && amount > maxAmount) return 0;

    const base =
      commissionType === EligibilityCommissionType.FLAT
        ? commissionValue
        : (commissionValue / 100) * amount;

    if (capAmount > 0 && base > capAmount) return capAmount;
    return base;
  }

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
      scopeIds,
      scopeObjectIds,
    };
  }

  private async resolveOwnerForQuery(query: any) {
    const ownerFromQuery = stringifyId(query?.ownerAgency);
    if (ownerFromQuery && Types.ObjectId.isValid(ownerFromQuery)) {
      return {
        ownerAgencyId: ownerFromQuery,
        sourceAgencyId: stringifyId(query?.channelAgency) || ownerFromQuery,
      };
    }

    const sourceAgencyId =
      stringifyId(query?.channelAgency) || stringifyId(query?.customerId);
    if (!sourceAgencyId || !Types.ObjectId.isValid(sourceAgencyId)) return null;

    const sourceAgency = await Agency.findById(sourceAgencyId)
      .select("_id role parentAgency")
      .lean();
    if (!sourceAgency) return null;

    const ownerAgencyId = stringifyId(
      sourceAgency.parentAgency || sourceAgency._id,
    );
    if (!ownerAgencyId || !Types.ObjectId.isValid(ownerAgencyId)) return null;

    return {
      ownerAgencyId,
      sourceAgencyId: stringifyId(sourceAgency._id),
    };
  }

  private getLoanDisbursedAmount(query: any) {
    const candidates = [
      query?.policyDetails?.disbursedAmount,
      query?.policyDetails?.finalDisbursedAmount,
      query?.policyDetails?.approvedAmount,
      query?.policyDetails?.sanctionedAmount,
      query?.policyDetails?.sanctionedLoanAmount,
      query?.loanAmount,
    ];
    for (const value of candidates) {
      const amount = toNumber(value);
      if (amount > 0) return amount;
    }
    return 0;
  }

  private async getEligibilityForLoan(query: any) {
    if (!query?.loanType) {
      return {
        eligibilityCriteriaId: undefined,
        eligibilityMatched: false,
        eligibilityKey: "loan_type_missing",
      };
    }

    const loanTypeKey = normalizeLookupValue(query.loanType);
    const bankNameKey = normalizeLookupValue(
      query?.bankName || query?.policyDetails?.bankName,
    );
    const salaryTypeKey = normalizeSalaryType(
      query?.employmentType || query?.salaryType,
    );

    const criteriaList = await EligibilityCriteria.find({
      status: EligibilityCriteriaStatus.ACTIVE,
    })
      .sort({ updatedAt: -1 })
      .lean();

    const pick = (matcher: (criteria: any) => boolean) =>
      criteriaList.find((criteria: any) => matcher(criteria));

    const criteria =
      pick((criteria: any) => {
        const criteriaLoan = normalizeLookupValue(criteria.loanType);
        const criteriaBank = normalizeLookupValue(criteria.bankName);
        const criteriaSalary = normalizeSalaryType(criteria.salaryType);
        return (
          criteriaLoan === loanTypeKey &&
          Boolean(bankNameKey) &&
          criteriaBank === bankNameKey &&
          Boolean(salaryTypeKey) &&
          criteriaSalary === salaryTypeKey
        );
      }) ||
      pick((criteria: any) => {
        const criteriaLoan = normalizeLookupValue(criteria.loanType);
        const criteriaBank = normalizeLookupValue(criteria.bankName);
        return (
          criteriaLoan === loanTypeKey &&
          Boolean(bankNameKey) &&
          criteriaBank === bankNameKey
        );
      }) ||
      pick(
        (criteria: any) =>
          normalizeLookupValue(criteria.loanType) === loanTypeKey,
      );

    if (!criteria) {
      return {
        eligibilityCriteriaId: undefined,
        eligibilityMatched: false,
        eligibilityKey: "criteria_not_found",
      };
    }

    const monthlyIncome = toNumber(query?.monthlyIncome);
    const cibilScore = toNumber(query?.cibilScore || query?.policyDetails?.cibilScore);
    const salaryOk =
      !criteria.salaryAmount || monthlyIncome >= toNumber(criteria.salaryAmount);
    const cibilOk =
      !criteria.cibilScoreWithCall || cibilScore >= toNumber(criteria.cibilScoreWithCall);

    return {
      eligibilityCriteriaId: criteria._id,
      eligibilityMatched: salaryOk && cibilOk,
      eligibilityKey: `loan_${query.loanType}_${criteria.bankName || "generic"}`,
      criteria,
    };
  }

  async estimateLoanCommission(query: any) {
    const disbursedAmount = this.getLoanDisbursedAmount(query);
    const baseAmount = disbursedAmount || toNumber(query?.loanAmount);
    const eligibility = await this.getEligibilityForLoan(query);
    const commissionAmount = this.computeCommissionFromCriteria(
      eligibility.criteria,
      baseAmount,
    );

    return {
      baseAmount,
      disbursedAmount,
      commissionAmount: Number(commissionAmount.toFixed(2)),
      criteria: eligibility.criteria,
      ...eligibility,
    };
  }

  async recordLoanDisbursalCommission(query: any, actorId?: string) {
    if (!query?._id) throw new ApiError(400, "Loan query is required");
    if (String(query.status) !== ApplicationStatus.DISBURSED) return null;

    const ownerInfo = await this.resolveOwnerForQuery(query);
    if (!ownerInfo?.ownerAgencyId) return null;

    const ownerObjectId = toObjectId(ownerInfo.ownerAgencyId);
    const sourceObjectId = toObjectId(ownerInfo.sourceAgencyId || "");
    if (!ownerObjectId) return null;

    const existing = await AgencyCommissionTransaction.findOne({
      ownerAgency: ownerObjectId,
      queryType: "loan",
      queryRef: query._id,
    }).lean();
    if (existing) return existing;

    const estimated = await this.estimateLoanCommission(query);
    if (estimated.commissionAmount <= 0) return null;

    const transaction = await AgencyCommissionTransaction.create({
      ownerAgency: ownerObjectId,
      sourceAgency: sourceObjectId || undefined,
      queryType: "loan",
      queryRef: query._id,
      customerId: query.customerId || undefined,
      customerName: `${query.firstName || ""} ${query.lastName || ""}`.trim(),
      loanType: query.loanType,
      productType: query.loanType,
      disbursedAmount: estimated.disbursedAmount || estimated.baseAmount,
      commissionAmount: estimated.commissionAmount,
      eligibilityCriteriaId: estimated.eligibilityCriteriaId,
      eligibilityMatched: estimated.eligibilityMatched,
      eligibilityKey: estimated.eligibilityKey,
      earningStatus: "earned",
      disbursedAt: new Date(),
      metadata: {
        pincode: query.pincode,
        cibilScore: query.cibilScore || query.policyDetails?.cibilScore,
        actorId,
      },
    });

    query.ownerAgency = ownerObjectId;
    if (!query.channelAgency && sourceObjectId) {
      query.channelAgency = sourceObjectId;
    }
    query.agencyCommissionRecorded = true;
    query.agencyCommissionRecordedAt = new Date();
    query.agencyCommissionTransactionId = transaction._id;
    await query.save();

    return transaction;
  }

  private buildOwnershipFilter(ownerObjectId: Types.ObjectId, scopeObjectIds: Types.ObjectId[]) {
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

  async getAgencySummary(agencyId: string, from?: string, to?: string) {
    const scope = await this.getScope(agencyId);
    const createdAt = dateRangeFilter(from, to);
    const ownershipFilter = this.buildOwnershipFilter(
      scope.ownerObjectId,
      scope.scopeObjectIds,
    );

    const projectedFilter: Record<string, any> = {
      ...ownershipFilter,
      status: { $nin: PROJECTED_EXCLUDED_STATUSES },
    };
    if (createdAt) projectedFilter.createdAt = createdAt;

    const projectedQueries = await LoanQuery.find(projectedFilter)
      .select(
        "_id loanId firstName lastName loanType loanAmount status createdAt updatedAt pincode monthlyIncome cibilScore policyDetails",
      )
      .sort({ updatedAt: -1 })
      .lean();

    const projectedRows = await Promise.all(
      projectedQueries.map(async (query: any) => {
        const estimate = await this.estimateLoanCommission(query);
        return {
          queryId: stringifyId(query._id),
          loanId: query.loanId || stringifyId(query._id),
          customerName: `${query.firstName || ""} ${query.lastName || ""}`.trim(),
          loanType: query.loanType,
          loanAmount: toNumber(query.loanAmount),
          estimatedCommission: estimate.commissionAmount,
          status: query.status,
          eligibilityMatched: estimate.eligibilityMatched,
          eligibilityKey: estimate.eligibilityKey,
          createdAt: query.createdAt,
        };
      }),
    );

    const txFilter: Record<string, any> = { ownerAgency: scope.ownerObjectId };
    if (createdAt) txFilter.createdAt = createdAt;
    const [earnedAgg, paidAgg, totalDisbursed] = await Promise.all([
      AgencyCommissionTransaction.aggregate([
        { $match: { ...txFilter, earningStatus: "earned" } },
        {
          $group: {
            _id: null,
            totalCommission: { $sum: "$commissionAmount" },
            totalDisbursedAmount: { $sum: "$disbursedAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      AgencyCommissionTransaction.aggregate([
        { $match: { ...txFilter, earningStatus: "paid" } },
        {
          $group: {
            _id: null,
            totalCommission: { $sum: "$commissionAmount" },
            totalDisbursedAmount: { $sum: "$disbursedAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      AgencyCommissionTransaction.countDocuments(txFilter),
    ]);

    const projectedTotal = projectedRows.reduce(
      (acc, row) => acc + toNumber(row.estimatedCommission),
      0,
    );
    const earned = earnedAgg?.[0] || {};
    const paid = paidAgg?.[0] || {};

    return {
      ownerAgencyId: scope.ownerAgencyId,
      range: { from, to },
      summary: {
        projectedCases: projectedRows.length,
        projectedAmount: Number(projectedTotal.toFixed(2)),
        earnedCases: Number(earned.count || 0),
        earnedAmount: Number(toNumber(earned.totalCommission).toFixed(2)),
        paidCases: Number(paid.count || 0),
        paidAmount: Number(toNumber(paid.totalCommission).toFixed(2)),
        disbursedCases: totalDisbursed,
      },
    };
  }

  async listAgencyEvents(params: {
    agencyId: string;
    tab: TabKey;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const { agencyId, tab, from, to } = params;
    const page = Math.max(Number(params.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const createdAt = dateRangeFilter(from, to);
    const scope = await this.getScope(agencyId);

    if (tab === "projected") {
      const filter: Record<string, any> = {
        ...this.buildOwnershipFilter(scope.ownerObjectId, scope.scopeObjectIds),
        status: { $nin: PROJECTED_EXCLUDED_STATUSES },
      };
      if (createdAt) filter.createdAt = createdAt;

      const [totalItems, rows] = await Promise.all([
        LoanQuery.countDocuments(filter),
        LoanQuery.find(filter)
          .select(
            "_id loanId firstName lastName loanType loanAmount status createdAt updatedAt pincode monthlyIncome cibilScore policyDetails",
          )
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const result = await Promise.all(
        rows.map(async (query: any) => {
          const estimate = await this.estimateLoanCommission(query);
          return {
            id: stringifyId(query._id),
            queryId: stringifyId(query._id),
            loanId: query.loanId || stringifyId(query._id),
            customerName: `${query.firstName || ""} ${query.lastName || ""}`.trim(),
            loanType: query.loanType,
            loanAmount: toNumber(query.loanAmount),
            commissionAmount: estimate.commissionAmount,
            status: query.status,
            eligibilityMatched: estimate.eligibilityMatched,
            eligibilityKey: estimate.eligibilityKey,
            createdAt: query.createdAt,
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

    const txFilter: Record<string, any> = {
      ownerAgency: scope.ownerObjectId,
      earningStatus: tab === "paid" ? "paid" : "earned",
    };
    if (createdAt) txFilter.createdAt = createdAt;

    const [totalItems, rows] = await Promise.all([
      AgencyCommissionTransaction.countDocuments(txFilter),
      AgencyCommissionTransaction.find(txFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const queryIds = rows
      .map((row) => stringifyId(row.queryRef))
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const queries = queryIds.length
      ? await LoanQuery.find({ _id: { $in: queryIds } })
          .select("_id loanId firstName lastName status")
          .lean()
      : [];
    const queryMap = new Map<string, any>(
      queries.map((query: any) => [stringifyId(query._id), query]),
    );

    const result = rows.map((row) => {
      const queryId = stringifyId(row.queryRef);
      const query = queryMap.get(queryId);
      return {
        id: stringifyId(row._id),
        queryId,
        loanId: query?.loanId || queryId,
        customerName:
          row.customerName ||
          `${query?.firstName || ""} ${query?.lastName || ""}`.trim(),
        loanType: row.loanType,
        disbursedAmount: toNumber(row.disbursedAmount),
        commissionAmount: toNumber(row.commissionAmount),
        status: row.earningStatus,
        queryStatus: query?.status,
        eligibilityMatched: Boolean(row.eligibilityMatched),
        eligibilityKey: row.eligibilityKey,
        disbursedAt: row.disbursedAt,
        paidAt: row.paidAt,
        paymentReference: row.paymentReference,
        createdAt: row.createdAt,
      };
    });

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

  async markCommissionPaid(input: {
    transactionId: string;
    paymentReference?: string;
    notes?: string;
    adminId?: string;
  }) {
    const transaction = await AgencyCommissionTransaction.findById(input.transactionId);
    if (!transaction) throw new ApiError(404, "Commission transaction not found");

    transaction.earningStatus = "paid";
    transaction.paidAt = new Date();
    if (input.paymentReference) transaction.paymentReference = input.paymentReference;
    if (input.notes) transaction.notes = input.notes;
    if (input.adminId && Types.ObjectId.isValid(input.adminId)) {
      transaction.paidBy = new Types.ObjectId(input.adminId);
    }
    await transaction.save();
    return transaction;
  }

  async getAgencyEarningsForAdmin(input: {
    agencyId: string;
    tab?: TabKey;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const summary = await this.getAgencySummary(input.agencyId, input.from, input.to);
    const tab = input.tab || "earned";
    const events = await this.listAgencyEvents({
      agencyId: input.agencyId,
      tab,
      from: input.from,
      to: input.to,
      page: input.page,
      limit: input.limit,
    });
    return { ...summary, tab, events };
  }
}

export const agencyEarningsService = new AgencyEarningsService();
