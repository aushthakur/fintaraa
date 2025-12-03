import { ClientSession } from "mongoose";
import CommissionRule, {
  ICommissionRule,
  CommissionRuleType,
  ProductType,
} from "../modals/commissionRule.model";
import ApiError from "../utils/ApiError";
import { LoanProductType } from "../modals/user.model";
import { InsuranceType } from "../modals/insurancequery.model";
import { WalletService } from "./wallet.service";

interface CommissionContext {
  amount: number; // Generic amount field (can be loan or insurance premium)
  queryType?: "loan" | "insurance"; // Type of query
  productType?: ProductType;
  cibilScore?: number;
  tags?: string[];
  geography?: {
    country?: string;
    state?: string;
    city?: string;
    pincode?: string;
  };
}

export class CommissionService {
  private computeFromRule(rule: ICommissionRule, amount: number) {
    if (rule.ruleType === "flat") {
      return rule.flatAmount || 0;
    }

    if (rule.ruleType === "percentage") {
      return ((rule.percentage || 0) / 100) * amount;
    }

    if (rule.ruleType === "slab" && rule.slabs && rule.slabs.length) {
      const matched = rule.slabs.find((slab) => {
        if (slab.maxAmount && amount > slab.maxAmount) return false;
        return amount >= slab.minAmount;
      });
      if (!matched) return 0;
      if (matched.rateType === "flat") return matched.rate;
      return (matched.rate / 100) * amount;
    }
    return 0;
  }

  async pickRule(context: CommissionContext) {
    const query: Record<string, any> = { isActive: true };
    
    // Match queryType (with backward compatibility for leadType)
    if (context.queryType) {
      query.$or = [
        { queryType: context.queryType },
        { leadType: context.queryType } // Backward compatibility
      ];
    }
    
    if (context.productType) query.productType = context.productType;
    if (context.geography?.pincode) query["geography.pincode"] = context.geography.pincode;
    
    // Match tags (check both new 'tags' and old 'leadTags' fields)
    if (context.tags && context.tags.length) {
      query.$or = [
        ...(query.$or || []),
        { tags: { $in: context.tags } },
        { leadTags: { $in: context.tags } } // Backward compatibility
      ];
    }

    const rules = (await CommissionRule.find(query)
      .sort({ priority: 1, createdAt: -1 })
      .lean()) as ICommissionRule[];

    return rules.find((rule) => {
      // Check new generic amount fields first, then fall back to old loan-specific fields
      const minAmount = rule.minAmount ?? rule.minLoanAmount;
      const maxAmount = rule.maxAmount ?? rule.maxLoanAmount;
      
      if (minAmount && context.amount < minAmount) return false;
      if (maxAmount && context.amount > maxAmount) return false;
      if (rule.minCibil && (context.cibilScore || 0) < rule.minCibil) return false;
      if (rule.maxCibil && (context.cibilScore || 0) > rule.maxCibil) return false;
      return true;
    });
  }

  // Unified method for recording commission for both loans and insurance
  async recordCommission(
    payload: {
      landerId: string;
      amount: number; // Can be loan amount or insurance premium
      queryId: string; // Can be loanQueryId or insuranceQueryId
      queryType: "loan" | "insurance"; // Type of query
      productType?: ProductType;
      cibilScore?: number;
      tags?: string[];
      geography?: {
        pincode?: string;
      };
    },
    session?: ClientSession
  ) {
    if (!payload.amount || payload.amount <= 0) {
      throw new ApiError(400, `${payload.queryType === "loan" ? "Loan" : "Insurance"} amount is required for commission`);
    }

    if (!payload.queryType) {
      throw new ApiError(400, "Query type (loan/insurance) is required");
    }

    const rule = await this.pickRule({
      amount: payload.amount,
      queryType: payload.queryType,
      productType: payload.productType,
      cibilScore: payload.cibilScore,
      tags: payload.tags,
      geography: payload.geography,
    });

    if (!rule) {
      throw new ApiError(404, `No active commission rule found for this ${payload.queryType} query`);
    }

    const commissionAmount = this.computeFromRule(rule, payload.amount);

    const { wallet, transaction } = await WalletService.credit({
      landerId: payload.landerId,
      amount: commissionAmount,
      referenceId: payload.queryId,
      type: "credit",
      description: `Commission for ${payload.queryType} query ${payload.queryId}`,
      metadata: {
        ruleId: rule._id,
        amount: payload.amount,
        queryType: payload.queryType,
        productType: payload.productType,
      },
      category: "commission",
      session,
    });

    return { wallet, transaction, rule, commissionAmount };
  }

  // Method for recording loan query commission
  async recordLoanCommission(
    payload: {
      landerId: string;
      loanAmount: number;
      loanQueryId: string; // ID of the completed loan query
      productType?: LoanProductType;
      cibilScore?: number;
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
        productType: payload.productType,
        cibilScore: payload.cibilScore,
        tags: payload.tags,
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
        geography: payload.geography,
      },
      session
    );
  }
}

export const commissionService = new CommissionService();
