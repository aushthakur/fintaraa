import { ClientSession } from "mongoose";
import CommissionRule, {
  ICommissionRule,
  CommissionRuleType,
  ProductType,
} from "../modals/commissionRule.model";
import ApiError from "../utils/ApiError";
import { User } from "../modals/user.model";
import { InsuranceType, InsuranceQuery } from "../modals/insurancequery.model";
import { LoanQuery, LoanType } from "../modals/loanquery.model";
import { WalletService } from "./wallet.service";
import {
  fetchSurepassCibilReport,
  prepareSurepassCibilPayload,
} from "./surepass.service";

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

    // Check if commission has already been recorded for this query
    const WalletTransaction = (await import("../modals/walletTransaction.model")).default;
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
        throw new ApiError(404, `Loan query with ID ${payload.queryId} not found`);
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
        throw new ApiError(404, `Insurance query with ID ${payload.queryId} not found`);
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
          console.warn(`No PAN number available for customer ${customerId}, skipping CIBIL fetch`);
        } else if (!query.mobile) {
          console.warn(`No mobile number available for customer ${customerId}, skipping CIBIL fetch`);
        } else if (!query.gender) {
          console.warn(`No gender available for customer ${customerId}, skipping CIBIL fetch`);
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
          cibilScore = cibilResponse.data?.data?.score || 
                      cibilResponse.data?.score || 
                      cibilResponse.data?.cibilScore;
          
          if (cibilScore) {
            // Save CIBIL score in user model
            user.cibilScore = cibilScore;
            user.cibilLastFetchedAt = new Date();
            await user.save({ session });
            
            console.log(`CIBIL score ${cibilScore} fetched and saved for customer ${customerId}`);
          }
        }
      } catch (error: any) {
        // Log the error but don't fail the commission calculation
        console.error(`Failed to fetch CIBIL score for customer ${customerId}:`, error.message);
        // Continue without CIBIL score
      }
    }

    const rule = await this.pickRule({
      amount: payload.amount,
      queryType: payload.queryType,
      productType: payload.productType,
      cibilScore: cibilScore || 500,
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
        cibilScore: cibilScore || 500,
      },
      category: "commission",
      session,
    });

    // Mark the query as commission recorded
    query.commissionRecorded = true;
    query.commissionRecordedAt = new Date();
    query.commissionTransactionId = transaction._id;
    await query.save({ session });

    return { wallet, transaction, rule, commissionAmount, cibilScore: cibilScore || 500 };
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
