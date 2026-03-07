import { Types } from "mongoose";
import ApiError from "../utils/ApiError";
import { Agency } from "../modals/agency.model";
import {
  AgencyPayoutRequest,
  AgencyPayoutMethod,
} from "../modals/agencyPayoutRequest.model";
import { AgencyCommissionTransaction } from "../modals/agencyCommissionTransaction.model";

const toObjectId = (value: string) =>
  Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;

const stringifyId = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === "object" && value._id) return stringifyId(value._id);
  return String(value);
};

const toNumber = (value: any): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

export class AgencyPayoutService {
  private async getOwnerScope(agencyId: string) {
    const agency = await Agency.findById(agencyId)
      .select("_id parentAgency")
      .lean();
    if (!agency) throw new ApiError(404, "Agency not found");

    const ownerAgencyId = stringifyId(agency.parentAgency || agency._id);
    const ownerObjectId = toObjectId(ownerAgencyId);
    if (!ownerObjectId) throw new ApiError(400, "Invalid agency scope");

    return { ownerAgencyId, ownerObjectId };
  }

  private async computeBalances(ownerObjectId: Types.ObjectId) {
    const [earnedAgg, paidAgg, pendingReqAgg] = await Promise.all([
      AgencyCommissionTransaction.aggregate([
        { $match: { ownerAgency: ownerObjectId, earningStatus: "earned" } },
        { $group: { _id: null, total: { $sum: "$commissionAmount" } } },
      ]),
      AgencyCommissionTransaction.aggregate([
        { $match: { ownerAgency: ownerObjectId, earningStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$commissionAmount" } } },
      ]),
      AgencyPayoutRequest.aggregate([
        {
          $match: {
            ownerAgency: ownerObjectId,
            status: { $in: ["pending", "approved", "processing"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const earnedAmount = toNumber(earnedAgg?.[0]?.total);
    const paidAmount = toNumber(paidAgg?.[0]?.total);
    const pendingRequestedAmount = toNumber(pendingReqAgg?.[0]?.total);
    const availableToRequest = Math.max(
      0,
      earnedAmount - paidAmount - pendingRequestedAmount,
    );

    return {
      earnedAmount,
      paidAmount,
      pendingRequestedAmount,
      availableToRequest,
    };
  }

  async getSummary(agencyId: string) {
    const scope = await this.getOwnerScope(agencyId);
    const [balances, statsAgg] = await Promise.all([
      this.computeBalances(scope.ownerObjectId),
      AgencyPayoutRequest.aggregate([
        { $match: { ownerAgency: scope.ownerObjectId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const stats = {
      totalRequests: 0,
      pendingRequests: 0,
      approvedRequests: 0,
      paidRequests: 0,
      failedRequests: 0,
    };

    for (const row of statsAgg) {
      const key = String(row?._id || "");
      const count = Number(row?.count || 0);
      stats.totalRequests += count;
      if (key === "pending" || key === "processing")
        stats.pendingRequests += count;
      if (key === "approved") stats.approvedRequests += count;
      if (key === "paid") stats.paidRequests += count;
      if (key === "failed" || key === "rejected") stats.failedRequests += count;
    }

    return {
      ownerAgencyId: scope.ownerAgencyId,
      balances,
      stats,
    };
  }

  async listRequests(input: {
    agencyId: string;
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const scope = await this.getOwnerScope(input.agencyId);
    const page = Math.max(Number(input.page || 1), 1);
    const limit = Math.min(Math.max(Number(input.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { ownerAgency: scope.ownerObjectId };
    if (
      input.status &&
      ["pending", "approved", "processing", "paid", "failed", "rejected"].includes(
        input.status,
      )
    ) {
      filter.status = input.status;
    }

    const [result, total] = await Promise.all([
      AgencyPayoutRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AgencyPayoutRequest.countDocuments(filter),
    ]);

    return {
      result,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit) || 1,
        currentPage: page,
        itemsPerPage: limit,
      },
    };
  }

  async createRequest(input: {
    agencyId: string;
    amount: number;
    method: AgencyPayoutMethod;
    upiId?: string;
    bankDetails?: {
      accountNumber?: string;
      ifsc?: string;
      accountHolder?: string;
      bankName?: string;
    };
    notes?: string;
  }) {
    const scope = await this.getOwnerScope(input.agencyId);
    const amount = Number(input.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, "Valid payout amount is required");
    }

    if (!["upi", "bank_transfer"].includes(String(input.method || ""))) {
      throw new ApiError(400, "Invalid payout method");
    }

    if (input.method === "upi" && !String(input.upiId || "").trim()) {
      throw new ApiError(400, "UPI ID is required for UPI payouts");
    }

    if (input.method === "bank_transfer") {
      const accountNumber = String(input.bankDetails?.accountNumber || "").trim();
      const ifsc = String(input.bankDetails?.ifsc || "").trim();
      if (!accountNumber || !ifsc) {
        throw new ApiError(400, "Account number and IFSC are required");
      }
    }

    const balances = await this.computeBalances(scope.ownerObjectId);
    if (amount > balances.availableToRequest) {
      throw new ApiError(
        400,
        `Insufficient available balance. You can request up to ₹${balances.availableToRequest.toFixed(
          2,
        )}`,
      );
    }

    const request = await AgencyPayoutRequest.create({
      ownerAgency: scope.ownerObjectId,
      requestedBy: new Types.ObjectId(input.agencyId),
      amount: Number(amount.toFixed(2)),
      method: input.method,
      upiId:
        input.method === "upi" ? String(input.upiId || "").trim() : undefined,
      bankDetails:
        input.method === "bank_transfer"
          ? {
              accountNumber: String(input.bankDetails?.accountNumber || "").trim(),
              ifsc: String(input.bankDetails?.ifsc || "").trim().toUpperCase(),
              accountHolder: String(input.bankDetails?.accountHolder || "").trim(),
              bankName: String(input.bankDetails?.bankName || "").trim(),
            }
          : undefined,
      notes: String(input.notes || "").trim() || undefined,
      status: "pending",
    });

    return request;
  }
}

export const agencyPayoutService = new AgencyPayoutService();
