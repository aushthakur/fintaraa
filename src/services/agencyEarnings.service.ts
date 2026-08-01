import { ClientSession, Types } from "mongoose";
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
import { AgencyCommissionRule } from "../modals/agencyCommissionRule.model";
import { AgencyPayoutRequest } from "../modals/agencyPayoutRequest.model";
import {
  getLoanTypeMatchValues,
  normalizeLoanType,
} from "../utils/loanType";

type TabKey = "projected" | "earned" | "paid";

const PROJECTED_EXCLUDED_STATUSES = [
  ApplicationStatus.DRAFT,
  ApplicationStatus.CANCELLED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.DISBURSED,
  ApplicationStatus.DISBURSED_PARTIAL_FULL,
  ApplicationStatus.COMPLETED,
  ApplicationStatus.COMPLETED_SUCCESS,
  ApplicationStatus.REJECTED_BY_BANK,
  ApplicationStatus.CANCELLED_BY_CUSTOMER,
  ApplicationStatus.DROPPED_LOST,
  ApplicationStatus.NOT_ELIGIBLE,
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

const normalizeLoanLookupValue = (value?: any) =>
  normalizeLoanType(String(value || "")) || normalizeLookupValue(value);

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

export const calculateDsaCommission = (
  rule: {
    calculationType?: string;
    value?: unknown;
    minLoanAmount?: unknown;
    maxLoanAmount?: unknown;
    capAmount?: unknown;
  },
  rawAmount: unknown,
) => {
  const amount = toNumber(rawAmount);
  const value = toNumber(rule?.value);
  const minAmount = toNumber(rule?.minLoanAmount);
  const maxAmount = toNumber(rule?.maxLoanAmount);
  if (
    amount <= 0 ||
    value < 0 ||
    (minAmount && amount < minAmount) ||
    (maxAmount && amount > maxAmount)
  ) {
    return 0;
  }
  const base =
    rule?.calculationType === "flat" ? value : (value / 100) * amount;
  const cap = toNumber(rule?.capAmount);
  return Number((cap > 0 ? Math.min(base, cap) : base).toFixed(2));
};

export class AgencyEarningsService {
  private async getCommissionRule(
    query: any,
    ownerAgencyId: string,
    amount: number,
    session?: ClientSession,
  ) {
    if (!query?.loanType || !Types.ObjectId.isValid(ownerAgencyId)) return null;
    const now = new Date();
    const loanTypeMatchValues = getLoanTypeMatchValues(query.loanType);
    if (!loanTypeMatchValues.length) return null;
    const rules = await AgencyCommissionRule.find({
      loanType: { $in: loanTypeMatchValues },
      isActive: true,
      $and: [
        { $or: [{ agency: new Types.ObjectId(ownerAgencyId) }, { agency: null }, { agency: { $exists: false } }] },
        { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: { $lte: now } }] },
        { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: now } }] },
        { $or: [{ minLoanAmount: { $exists: false } }, { minLoanAmount: null }, { minLoanAmount: { $lte: amount } }] },
        { $or: [{ maxLoanAmount: { $exists: false } }, { maxLoanAmount: null }, { maxLoanAmount: { $gte: amount } }] },
      ],
    })
      .sort({ priority: -1, updatedAt: -1 })
      .session(session || null)
      .lean();
    return (
      rules.find((rule: any) => stringifyId(rule.agency) === ownerAgencyId) ||
      rules.find((rule: any) => !rule.agency) ||
      null
    );
  }

  private computeCommissionFromRule(rule: any, amount: number) {
    return calculateDsaCommission(rule, amount);
  }
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

  private async resolveOwnerForQuery(query: any, session?: ClientSession) {
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
      .session(session || null)
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
      query?.disbursedAmount,
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

  private async getEligibilityForLoan(query: any, session?: ClientSession) {
    if (!query?.loanType) {
      return {
        eligibilityCriteriaId: undefined,
        eligibilityMatched: false,
        eligibilityKey: "loan_type_missing",
      };
    }

    const loanTypeKey = normalizeLoanLookupValue(query.loanType);
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
      .session(session || null)
      .lean();

    const pick = (matcher: (criteria: any) => boolean) =>
      criteriaList.find((criteria: any) => matcher(criteria));

    const criteria =
      pick((criteria: any) => {
        const criteriaLoan = normalizeLoanLookupValue(criteria.loanType);
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
        const criteriaLoan = normalizeLoanLookupValue(criteria.loanType);
        const criteriaBank = normalizeLookupValue(criteria.bankName);
        return (
          criteriaLoan === loanTypeKey &&
          Boolean(bankNameKey) &&
          criteriaBank === bankNameKey
        );
      }) ||
      pick(
        (criteria: any) =>
          normalizeLoanLookupValue(criteria.loanType) === loanTypeKey,
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
    const legacyCibilScore = (criteria as any)?.cibilScoreWithCall;
    const salaryOk =
      !criteria.netSalary || monthlyIncome >= toNumber(criteria.netSalary);
    const cibilOk =
      !(criteria.cibilScore ?? legacyCibilScore) ||
      cibilScore >= toNumber(criteria.cibilScore ?? legacyCibilScore);

    return {
      eligibilityCriteriaId: criteria._id,
      eligibilityMatched: salaryOk && cibilOk,
      eligibilityKey: `loan_${query.loanType}_${criteria.bankName || "generic"}`,
      criteria,
    };
  }

  async estimateLoanCommission(
    query: any,
    ownerAgencyId?: string,
    session?: ClientSession,
  ) {
    const disbursedAmount = this.getLoanDisbursedAmount(query);
    const baseAmount = disbursedAmount || toNumber(query?.loanAmount);
    const configuredRule = ownerAgencyId
      ? await this.getCommissionRule(query, ownerAgencyId, baseAmount, session)
      : null;
    if (configuredRule) {
      return {
        baseAmount,
        disbursedAmount,
        commissionAmount: Number(
          this.computeCommissionFromRule(configuredRule, baseAmount).toFixed(2),
        ),
        commissionRule: configuredRule,
        commissionRuleId: configuredRule._id,
        eligibilityCriteriaId: undefined,
        eligibilityMatched: true,
        eligibilityKey: `dsa_rule_${configuredRule._id}`,
        criteria: undefined,
      };
    }
    const eligibility = await this.getEligibilityForLoan(query, session);
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

  async recordLoanCommissionLifecycle(
    query: any,
    actorId?: string,
    session?: ClientSession,
  ) {
    if (!query?._id) throw new ApiError(400, "Loan query is required");
    const status = String(query.status || "");
    const approvedStatuses = new Set<string>([
      ApplicationStatus.APPROVED,
      ApplicationStatus.LOGIN_APPROVED,
      ApplicationStatus.SANCTIONED,
      ApplicationStatus.APPROVED_WITH_CONDITIONS,
    ]);
    const disbursedStatuses = new Set<string>([
      ApplicationStatus.DISBURSED,
      ApplicationStatus.DISBURSED_PARTIAL_FULL,
      ApplicationStatus.COMPLETED_SUCCESS,
    ]);
    const reversalStatuses = new Set<string>([
      ApplicationStatus.REJECTED,
      ApplicationStatus.CANCELLED,
      ApplicationStatus.REJECTED_BY_BANK,
      ApplicationStatus.CANCELLED_BY_CUSTOMER,
      ApplicationStatus.DROPPED_LOST,
      ApplicationStatus.NOT_ELIGIBLE,
    ]);
    const accrualStage = disbursedStatuses.has(status)
      ? "disbursed"
      : approvedStatuses.has(status)
        ? "approved"
        : null;
    if (!accrualStage) {
      if (!reversalStatuses.has(status)) return null;
      const transaction: any = await AgencyCommissionTransaction.findOne({
        queryType: "loan",
        queryRef: query._id,
        isCanonical: { $ne: false },
        earningStatus: { $in: ["pending", "earned", "paid"] },
      })
        .sort({ isCanonical: -1, updatedAt: -1 })
        .session(session || null);
      if (!transaction) return null;
      const paidAmount = toNumber(transaction.paidAmount);
      transaction.earningStatus = paidAmount > 0 ? "clawback_required" : "reversed";
      transaction.metadata = {
        ...(transaction.metadata || {}),
        reversedAt: new Date(),
        reversedBy: actorId,
        reversalStatus: status,
        ...(paidAmount > 0
          ? { clawbackAmount: paidAmount, reconciliationStatus: "open" }
          : {}),
      };
      await transaction.save({ session });
      return transaction;
    }

    const ownerInfo = await this.resolveOwnerForQuery(query, session);
    if (!ownerInfo?.ownerAgencyId) return null;
    const ownerObjectId = toObjectId(ownerInfo.ownerAgencyId);
    const sourceObjectId = toObjectId(ownerInfo.sourceAgencyId || "");
    if (!ownerObjectId) return null;

    const existing = await AgencyCommissionTransaction.findOne({
      queryType: "loan",
      queryRef: query._id,
      isCanonical: { $ne: false },
    })
      .sort({ isCanonical: -1, updatedAt: -1 })
      .session(session || null);
    if (
      existing &&
      ["earned", "paid", "clawback_required"].includes(existing.earningStatus)
    ) {
      return existing;
    }
    if (existing?.earningStatus === "pending" && accrualStage === "approved") {
      return existing;
    }

    const estimated = await this.estimateLoanCommission(
      query,
      ownerInfo.ownerAgencyId,
      session,
    );
    if (!existing && estimated.commissionAmount <= 0) return null;
    const snapshottedRule = existing?.commissionRuleSnapshot;
    const commissionAmount = existing
      ? snapshottedRule && accrualStage === "disbursed"
        ? Number(
            this.computeCommissionFromRule(
              snapshottedRule,
              estimated.disbursedAmount || estimated.baseAmount,
            ).toFixed(2),
          )
        : toNumber(existing.commissionAmount)
      : estimated.commissionAmount;
    if (existing && commissionAmount <= 0) {
      existing.earningStatus = "reversed";
      existing.metadata = {
        ...(existing.metadata || {}),
        reversedAt: new Date(),
        reversedBy: actorId,
        reversalStatus: "commission_rule_not_matched_at_disbursal",
      };
      await existing.save({ session });
      return existing;
    }

    const lifecycleFields = {
      isCanonical: true,
      ownerAgency: existing?.ownerAgency || ownerObjectId,
      sourceAgency: existing?.sourceAgency || sourceObjectId || undefined,
      queryType: "loan" as const,
      queryRef: query._id,
      customerId: query.customerId || undefined,
      customerName: `${query.firstName || ""} ${query.lastName || ""}`.trim(),
      loanType: query.loanType,
      productType: query.loanType,
      disbursedAmount: estimated.disbursedAmount || estimated.baseAmount,
      commissionAmount,
      commissionRuleId: existing?.commissionRuleId || estimated.commissionRuleId,
      commissionRuleSnapshot: existing?.commissionRuleSnapshot || (estimated.commissionRule
        ? {
            calculationType: estimated.commissionRule.calculationType,
            value: estimated.commissionRule.value,
            minLoanAmount: estimated.commissionRule.minLoanAmount,
            maxLoanAmount: estimated.commissionRule.maxLoanAmount,
            capAmount: estimated.commissionRule.capAmount,
          }
        : undefined),
      eligibilityCriteriaId:
        existing?.eligibilityCriteriaId || estimated.eligibilityCriteriaId,
      eligibilityMatched:
        existing?.eligibilityMatched ?? estimated.eligibilityMatched,
      eligibilityKey: existing?.eligibilityKey || estimated.eligibilityKey,
      earningStatus: accrualStage === "disbursed" ? "earned" : "pending",
      accrualStage,
      disbursedAt:
        accrualStage === "disbursed"
          ? query?.disbursedDate || query?.policyDetails?.disbursedDate || new Date()
          : undefined,
      metadata: {
        ...(existing?.metadata || {}),
        pincode: query.pincode,
        cibilScore: query.cibilScore || query.policyDetails?.cibilScore,
        actorId,
        lastLifecycleStatus: status,
        lastLifecycleAt: new Date(),
      },
    };
    const transaction = existing
      ? await AgencyCommissionTransaction.findByIdAndUpdate(
          existing._id,
          { $set: lifecycleFields },
          { new: true, session },
        )
      : await AgencyCommissionTransaction.findOneAndUpdate(
          {
            queryType: "loan",
            queryRef: query._id,
            isCanonical: { $ne: false },
          },
          { $setOnInsert: lifecycleFields },
          { new: true, upsert: true, setDefaultsOnInsert: true, session },
        ).catch(async (error: any) => {
          if (error?.code !== 11000 || session) throw error;
          return AgencyCommissionTransaction.findOne({
            queryType: "loan",
            queryRef: query._id,
            isCanonical: true,
          }).session(session || null);
        });

    query.ownerAgency = ownerObjectId;
    if (!query.channelAgency && sourceObjectId) query.channelAgency = sourceObjectId;
    query.agencyCommissionTransactionId = transaction?._id;
    if (accrualStage === "disbursed") {
      query.agencyCommissionRecorded = true;
      query.agencyCommissionRecordedAt = new Date();
    }
    if (typeof query.save === "function") {
      await query.save({ session });
    } else {
      await LoanQuery.findByIdAndUpdate(
        query._id,
        {
          $set: {
            ownerAgency: ownerObjectId,
            ...(query.channelAgency || !sourceObjectId
              ? {}
              : { channelAgency: sourceObjectId }),
            agencyCommissionTransactionId: transaction?._id,
            ...(accrualStage === "disbursed"
              ? {
                  agencyCommissionRecorded: true,
                  agencyCommissionRecordedAt: new Date(),
                }
              : {}),
          },
        },
        { session },
      );
    }
    return transaction;
  }

  async recordLoanDisbursalCommission(
    query: any,
    actorId?: string,
    session?: ClientSession,
  ) {
    if (!query?._id) throw new ApiError(400, "Loan query is required");
    if (
      ![
        ApplicationStatus.DISBURSED,
        ApplicationStatus.DISBURSED_PARTIAL_FULL,
        ApplicationStatus.COMPLETED_SUCCESS,
      ].includes(query.status)
    ) return null;

    return this.recordLoanCommissionLifecycle(query, actorId, session);
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
        const estimate = await this.estimateLoanCommission(
          query,
          scope.ownerAgencyId,
        );
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

    const txFilter: Record<string, any> = {
      ownerAgency: scope.ownerObjectId,
      isCanonical: { $ne: false },
    };
    if (createdAt) txFilter.createdAt = createdAt;
    const [earnedAgg, paidAgg, totalDisbursed] = await Promise.all([
      AgencyCommissionTransaction.aggregate([
        { $match: { ...txFilter, earningStatus: "earned" } },
        {
          $group: {
            _id: null,
            totalCommission: {
              $sum: {
                $subtract: ["$commissionAmount", { $ifNull: ["$paidAmount", 0] }],
              },
            },
            totalDisbursedAmount: { $sum: "$disbursedAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      AgencyCommissionTransaction.aggregate([
        { $match: txFilter },
        {
          $group: {
            _id: null,
            totalCommission: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] },
                  "$paidAmount",
                  { $cond: [{ $eq: ["$earningStatus", "paid"] }, "$commissionAmount", 0] },
                ],
              },
            },
            totalDisbursedAmount: { $sum: "$disbursedAmount" },
            count: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$earningStatus", "paid"] },
                      { $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      AgencyCommissionTransaction.countDocuments({
        ...txFilter,
        earningStatus: { $in: ["earned", "paid"] },
      }),
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
          const estimate = await this.estimateLoanCommission(
            query,
            scope.ownerAgencyId,
          );
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
      isCanonical: { $ne: false },
      ...(tab === "paid"
        ? {
            $or: [
              { earningStatus: "paid" },
              { paidAmount: { $gt: 0 } },
            ],
          }
        : { earningStatus: "earned" }),
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
        paidAmount: toNumber((row as any).paidAmount),
        outstandingAmount: Math.max(
          0,
          toNumber(row.commissionAmount) - toNumber((row as any).paidAmount),
        ),
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
    const paymentReference = String(input.paymentReference || "").trim();
    if (!paymentReference) {
      throw new ApiError(400, "Payment reference is required");
    }
    const transaction = await AgencyCommissionTransaction.findById(input.transactionId);
    if (!transaction) throw new ApiError(404, "Commission transaction not found");
    if (transaction.isCanonical === false) {
      throw new ApiError(409, "Superseded commission records cannot be paid");
    }

    if (transaction.earningStatus === "paid") {
      if (
        transaction.paymentReference &&
        paymentReference !== transaction.paymentReference
      ) {
        throw new ApiError(409, "Commission is already paid with a different reference");
      }
      return transaction;
    }
    if (transaction.earningStatus !== "earned") {
      throw new ApiError(409, "Only earned commission can be paid");
    }
    const activePayout = await AgencyPayoutRequest.exists({
      ownerAgency: transaction.ownerAgency,
      status: { $in: ["pending", "approved", "processing"] },
    });
    if (activePayout) {
      throw new ApiError(409, "An active payout reservation exists for this DSA");
    }

    transaction.earningStatus = "paid";
    transaction.paidAmount = transaction.commissionAmount;
    transaction.paidAt = new Date();
    transaction.paymentReference = paymentReference;
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
