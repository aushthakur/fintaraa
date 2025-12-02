import { ClientSession } from "mongoose";
import CommissionRule, {
  ICommissionRule,
  CommissionRuleType,
} from "../modals/commissionRule.model";
import ApiError from "../utils/ApiError";
import { LoanProductType } from "../modals/user.model";
import { WalletService } from "./wallet.service";

interface CommissionContext {
  loanAmount: number;
  productType?: LoanProductType;
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
    if (context.productType) query.productType = context.productType;
    if (context.geography?.pincode) query["geography.pincode"] = context.geography.pincode;
    if (context.tags && context.tags.length) query.leadTags = { $in: context.tags };

    const rules = (await CommissionRule.find(query)
      .sort({ priority: 1, createdAt: -1 })
      .lean()) as ICommissionRule[];

    return rules.find((rule) => {
      if (rule.minLoanAmount && context.loanAmount < rule.minLoanAmount)
        return false;
      if (rule.maxLoanAmount && context.loanAmount > rule.maxLoanAmount)
        return false;
      if (rule.minCibil && (context.cibilScore || 0) < rule.minCibil) return false;
      if (rule.maxCibil && (context.cibilScore || 0) > rule.maxCibil) return false;
      return true;
    });
  }

  async recordCommission(
    payload: {
      landerId: string;
      loanAmount: number;
      loanId: string;
      productType?: LoanProductType;
      cibilScore?: number;
      tags?: string[];
    },
    session?: ClientSession
  ) {
    if (!payload.loanAmount || payload.loanAmount <= 0) {
      throw new ApiError(400, "Loan amount is required for commission");
    }

    const rule = await this.pickRule({
      loanAmount: payload.loanAmount,
      productType: payload.productType,
      cibilScore: payload.cibilScore,
      tags: payload.tags,
    });

    if (!rule) {
      throw new ApiError(404, "No active commission rule found for this loan");
    }

    const commissionAmount = this.computeFromRule(rule, payload.loanAmount);

    const { wallet, transaction } = await WalletService.credit({
      landerId: payload.landerId,
      amount: commissionAmount,
      referenceId: payload.loanId,
      type: "credit",
      description: `Commission for loan ${payload.loanId}`,
      metadata: {
        ruleId: rule._id,
        loanAmount: payload.loanAmount,
        productType: payload.productType,
      },
      category: "commission",
      session,
    });

    return { wallet, transaction, rule, commissionAmount };
  }
}

export const commissionService = new CommissionService();
