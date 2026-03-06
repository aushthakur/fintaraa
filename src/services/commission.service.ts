import { ClientSession } from "mongoose";
import ApiError from "../utils/ApiError";
import { User } from "../modals/user.model";
import { InsuranceType, InsuranceQuery } from "../modals/insurancequery.model";
import { LoanQuery, LoanType } from "../modals/loanquery.model";
import {
  EligibilityCriteria,
  EligibilityCommissionType,
  EligibilityCriteriaStatus,
} from "../modals/eligibilityCriteria.model";
import { WalletService } from "./wallet.service";
import {
  fetchSurepassCibilReport,
  prepareSurepassCibilPayload,
} from "./surepass.service";

type ProductType = LoanType | InsuranceType | string;

const toNumber = (value: any) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

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

export class CommissionService {
  private computeFromEligibility(
    criteria: any,
    amount: number,
    fallbackType: "percentage" | "flat" = "percentage",
    fallbackValue = 0,
  ) {
    const commissionType = String(
      criteria?.commissionType || fallbackType,
    ).toLowerCase();
    const commissionValue = toNumber(
      criteria?.commissionValue ?? fallbackValue,
    );
    const minAmount = toNumber(criteria?.commissionMinAmount);
    const maxAmount = toNumber(criteria?.commissionMaxAmount);
    const capAmount = toNumber(criteria?.commissionCapAmount);

    if (!commissionValue || amount <= 0) return 0;
    if (minAmount && amount < minAmount) return 0;
    if (maxAmount && amount > maxAmount) return 0;

    const computed =
      commissionType === EligibilityCommissionType.FLAT
        ? commissionValue
        : (commissionValue / 100) * amount;

    if (capAmount > 0 && computed > capAmount) return capAmount;
    return computed;
  }

  private async pickEligibilityCriteria(input: {
    loanType?: string;
    bankName?: string;
    salaryType?: string;
  }) {
    const loanTypeKey = normalizeLookupValue(input.loanType);
    if (!loanTypeKey) return null;

    const bankNameKey = normalizeLookupValue(input.bankName);
    const salaryTypeKey = normalizeSalaryType(input.salaryType);

    const rows = await EligibilityCriteria.find({
      status: EligibilityCriteriaStatus.ACTIVE,
    })
      .sort({ updatedAt: -1 })
      .lean();

    const pick = (matcher: (criteria: any) => boolean) =>
      rows.find((criteria: any) => matcher(criteria));

    return (
      pick((criteria: any) => {
        const rowLoan = normalizeLookupValue(criteria.loanType);
        const rowBank = normalizeLookupValue(criteria.bankName);
        const rowSalary = normalizeSalaryType(criteria.salaryType);
        return (
          rowLoan === loanTypeKey &&
          Boolean(bankNameKey) &&
          rowBank === bankNameKey &&
          Boolean(salaryTypeKey) &&
          rowSalary === salaryTypeKey
        );
      }) ||
      pick((criteria: any) => {
        const rowLoan = normalizeLookupValue(criteria.loanType);
        const rowBank = normalizeLookupValue(criteria.bankName);
        return (
          rowLoan === loanTypeKey &&
          Boolean(bankNameKey) &&
          rowBank === bankNameKey
        );
      }) ||
      pick(
        (criteria: any) =>
          normalizeLookupValue(criteria.loanType) === loanTypeKey,
      ) ||
      null
    );
  }

  // Unified method for recording commission for both loans and insurance
  async recordCommission(
    payload: {
      landerId: string;
      amount: number; // Can be loan amount or insurance premium
      queryId: string; // Can be loanQueryId or insuranceQueryId
      queryType: "loan" | "insurance"; // Type of query
      productType?: ProductType;
      tags?: string[];
      commissionRate?: number;
      commissionAmount?: number;
      geography?: {
        pincode?: string;
      };
    },
    session?: ClientSession
  ) {
    if (!payload.amount || payload.amount <= 0) {
      throw new ApiError(
        400,
        `${
          payload.queryType === "loan" ? "Loan" : "Insurance"
        } amount is required for commission`
      );
    }

    if (!payload.queryType) {
      throw new ApiError(400, "Query type (loan/insurance) is required");
    }

    // Check if commission has already been recorded for this query
    const WalletTransaction = (
      await import("../modals/walletTransaction.model")
    ).default;
    const existingCommission = await WalletTransaction.findOne({
      referenceId: payload.queryId,
      category: "commission",
    }).lean();

    if (existingCommission) {
      throw new ApiError(
        409,
        `Commission has already been recorded for this ${payload.queryType} query (Transaction ID: ${existingCommission._id})`
      );
    }

    // Fetch the query to get customer information
    let query: any;
    let customerId: string;

    if (payload.queryType === "loan") {
      query = await LoanQuery.findById(payload.queryId);
      if (!query) {
        throw new ApiError(
          404,
          `Loan query with ID ${payload.queryId} not found`
        );
      }

      // Check if commission has already been recorded for this loan query
      if (query.commissionRecorded) {
        throw new ApiError(
          409,
          `Commission has already been recorded for this loan query on ${query.commissionRecordedAt?.toLocaleDateString()}`
        );
      }

      customerId = query.customerId.toString();
    } else {
      query = await InsuranceQuery.findById(payload.queryId);
      if (!query) {
        throw new ApiError(
          404,
          `Insurance query with ID ${payload.queryId} not found`
        );
      }

      // Check if commission has already been recorded for this insurance query
      if (query.commissionRecorded) {
        throw new ApiError(
          409,
          `Commission has already been recorded for this insurance query on ${query.commissionRecordedAt?.toLocaleDateString()}`
        );
      }

      customerId = query.customerId.toString();
    }

    // Fetch the customer/user
    const user = await User.findById(customerId);
    if (!user) {
      throw new ApiError(404, `Customer with ID ${customerId} not found`);
    }

    // Get or fetch CIBIL score
    let cibilScore = user.cibilScore;

    if (!cibilScore) {
      // Fetch CIBIL score from Surepass
      try {
        // Prepare data for CIBIL fetch
        const firstName = query.firstName || "";
        const lastName = query.lastName || "";
        const fullName = `${firstName} ${lastName}`.trim();

        // For loan queries, PAN is directly available
        // For insurance queries, we need to check if KYC document type is PAN
        let panNumber = query.panNumber || user.panCard;

        if (!panNumber && payload.queryType === "insurance") {
          // Check if user has PAN in their profile
          panNumber = user.panCard;
        }

        if (!panNumber) {
          console.warn(
            `No PAN number available for customer ${customerId}, skipping CIBIL fetch`
          );
        } else if (!query.mobile) {
          console.warn(
            `No mobile number available for customer ${customerId}, skipping CIBIL fetch`
          );
        } else if (!query.gender) {
          console.warn(
            `No gender available for customer ${customerId}, skipping CIBIL fetch`
          );
        } else {
          // Fetch CIBIL score
          const cibilPayload = prepareSurepassCibilPayload({
            name: fullName,
            pan: panNumber,
            mobile: query.mobile,
            gender: query.gender,
            consent: "Y",
          });

          const cibilResponse = await fetchSurepassCibilReport(cibilPayload);

          // Extract CIBIL score from response
          // Adjust this based on actual Surepass API response structure
          cibilScore =
            cibilResponse.data?.data?.score ||
            cibilResponse.data?.score ||
            cibilResponse.data?.cibilScore;

          if (cibilScore) {
            // Save CIBIL score in user model
            user.cibilScore = cibilScore;
            user.cibilLastFetchedAt = new Date();
            await user.save({ session });

            console.log(
              `CIBIL score ${cibilScore} fetched and saved for customer ${customerId}`
            );
          }
        }
      } catch (error: any) {
        // Log the error but don't fail the commission calculation
        console.error(
          `Failed to fetch CIBIL score for customer ${customerId}:`,
          error.message
        );
        // Continue without CIBIL score
      }
    }

    let commissionAmount = 0;
    let commissionSource: any = null;

    if (payload.queryType === "loan") {
      const criteria = await this.pickEligibilityCriteria({
        loanType: query?.loanType || payload.productType,
        bankName: query?.bankName || query?.policyDetails?.bankName,
        salaryType: query?.employmentType || query?.salaryType,
      });
      if (!criteria) {
        throw new ApiError(
          404,
          "No active eligibility criteria found for this loan/bank combination",
        );
      }
      commissionAmount = this.computeFromEligibility(criteria, payload.amount);
      commissionSource = criteria;
    } else {
      // Insurance flow does not use eligibility criteria currently.
      // Fallback to a default 1% unless explicitly provided by caller.
      const fallbackRate = toNumber((payload as any).commissionRate) || 1;
      const fallbackFlat = toNumber((payload as any).commissionAmount);
      commissionAmount = fallbackFlat
        ? fallbackFlat
        : this.computeFromEligibility(
            { commissionType: "percentage", commissionValue: fallbackRate },
            payload.amount,
          );
    }

    if (commissionAmount <= 0) {
      throw new ApiError(
        400,
        `Commission could not be calculated for this ${payload.queryType} query`,
      );
    }

    const { wallet, transaction } = await WalletService.credit({
      landerId: payload.landerId,
      amount: commissionAmount,
      referenceId: payload.queryId,
      type: "credit",
      description: `Commission for ${payload.queryType} query ${payload.queryId}`,
      metadata: {
        amount: payload.amount,
        queryType: payload.queryType,
        productType: payload.productType,
        cibilScore: cibilScore || 500,
        eligibilityCriteriaId: commissionSource?._id,
        eligibilityLoanType: commissionSource?.loanType,
        eligibilityBankName: commissionSource?.bankName,
        commissionType: commissionSource?.commissionType,
        commissionValue: commissionSource?.commissionValue,
      },
      category: "commission",
      session,
    });

    // Mark the query as commission recorded
    query.commissionRecorded = true;
    query.commissionRecordedAt = new Date();
    query.commissionTransactionId = transaction._id;
    await query.save({ session });

    return {
      wallet,
      transaction,
      criteria: commissionSource,
      commissionAmount,
      cibilScore: cibilScore || 500,
    };
  }

  // Method for recording loan query commission
  async recordLoanCommission(
    payload: {
      landerId: string;
      loanAmount: number;
      loanQueryId: string; // ID of the completed loan query
      productType?: ProductType;
      tags?: string[];
    },
    session?: ClientSession
  ) {
    return this.recordCommission(
      {
        landerId: payload.landerId,
        amount: payload.loanAmount,
        queryId: payload.loanQueryId,
        queryType: "loan",
        productType: payload.productType as ProductType,
        tags: payload.tags || [],
      },
      session
    );
  }

  // Method for recording insurance query commission
  async recordInsuranceCommission(
    payload: {
      landerId: string;
      insuranceAmount: number; // Premium or sum assured
      insuranceQueryId: string; // ID of the completed insurance query
      insuranceType?: InsuranceType;
      tags?: string[];
      commissionRate?: number;
      commissionAmount?: number;
      geography?: {
        pincode?: string;
      };
    },
    session?: ClientSession
  ) {
    return this.recordCommission(
      {
        landerId: payload.landerId,
        amount: payload.insuranceAmount,
        queryId: payload.insuranceQueryId,
        queryType: "insurance",
        productType: payload.insuranceType,
        tags: payload.tags,
        commissionRate: payload.commissionRate,
        commissionAmount: payload.commissionAmount,
        geography: payload.geography,
      },
      session
    );
  }
}

export const commissionService = new CommissionService();
