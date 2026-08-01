import { Types } from "mongoose";
import ApiError from "../utils/ApiError";
import { Agency } from "../modals/agency.model";
import {
  AgencyPayoutRequest,
  AgencyPayoutMethod,
} from "../modals/agencyPayoutRequest.model";
import { AgencyCommissionTransaction } from "../modals/agencyCommissionTransaction.model";
import { AgencyPayoutProfile } from "../modals/agencyPayoutProfile.model";
import { agencyPayoutProfileService } from "./agencyPayoutProfile.service";

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

export const MINIMUM_DSA_PAYOUT_AMOUNT = 0.01;

export const validateDsaPayoutAmount = (
  rawAmount: unknown,
  availableAmount?: number,
) => {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < MINIMUM_DSA_PAYOUT_AMOUNT) {
    throw new ApiError(400, "Valid payout amount is required");
  }
  const rounded = Number(amount.toFixed(2));
  if (Math.abs(amount - rounded) > Number.EPSILON) {
    throw new ApiError(400, "Payout amount can have at most two decimal places");
  }
  if (
    availableAmount !== undefined &&
    rounded > Number(availableAmount.toFixed(2))
  ) {
    throw new ApiError(
      400,
      `Insufficient available balance. You can request up to ₹${availableAmount.toFixed(
        2,
      )}`,
    );
  }
  return rounded;
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
        {
          $match: {
            ownerAgency: ownerObjectId,
            earningStatus: "earned",
            isCanonical: { $ne: false },
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $let: {
                  vars: {
                    outstanding: {
                      $subtract: ["$commissionAmount", { $ifNull: ["$paidAmount", 0] }],
                    },
                  },
                  in: { $cond: [{ $gt: ["$$outstanding", 0] }, "$$outstanding", 0] },
                },
              },
            },
          },
        },
      ]),
      AgencyCommissionTransaction.aggregate([
        { $match: { ownerAgency: ownerObjectId, isCanonical: { $ne: false } } },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] },
                  "$paidAmount",
                  { $cond: [{ $eq: ["$earningStatus", "paid"] }, "$commissionAmount", 0] },
                ],
              },
            },
          },
        },
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
    // `earned` contains only unpaid ledger rows; paid rows are already excluded.
    const availableToRequest = Math.max(0, earnedAmount - pendingRequestedAmount);

    return {
      earnedAmount,
      paidAmount,
      pendingRequestedAmount,
      availableToRequest,
      minimumPayoutAmount: MINIMUM_DSA_PAYOUT_AMOUNT,
      canRequestPayout:
        availableToRequest >= MINIMUM_DSA_PAYOUT_AMOUNT &&
        pendingRequestedAmount === 0,
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
        .select("-upiId -bankDetails")
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
    const requestingAgency: any = await Agency.findById(input.agencyId)
      .select("_id role parentAgency")
      .lean();
    if (!requestingAgency) throw new ApiError(404, "Agency not found");
    if (requestingAgency.role !== "agency" || requestingAgency.parentAgency) {
      throw new ApiError(403, "Only the primary DSA can request payouts");
    }
    const scope = await this.getOwnerScope(input.agencyId);
    const amount = validateDsaPayoutAmount(input.amount);

    if (!["upi", "bank_transfer"].includes(String(input.method || ""))) {
      throw new ApiError(400, "Invalid payout method");
    }

    let payoutProfile: any = await AgencyPayoutProfile.findOne({
      agency: scope.ownerObjectId,
    }).select("+encryptedPayload").lean();
    // Backward-compatible secure upgrade: legacy clients may send the destination
    // once, but it is encrypted into the profile and never copied raw to a request.
    if (!payoutProfile && (input.upiId || input.bankDetails?.accountNumber)) {
      await agencyPayoutProfileService.upsert({
        agencyId: scope.ownerAgencyId,
        method: input.method,
        upiId: input.upiId,
        accountNumber: input.bankDetails?.accountNumber,
        ifsc: input.bankDetails?.ifsc,
        accountHolder: input.bankDetails?.accountHolder,
        bankName: input.bankDetails?.bankName,
        updatedBy: input.agencyId,
      });
      payoutProfile = await AgencyPayoutProfile.findOne({
        agency: scope.ownerObjectId,
      }).select("+encryptedPayload").lean();
    }
    if (!payoutProfile) {
      throw new ApiError(400, "Save an encrypted payout profile before requesting payout");
    }
    if (payoutProfile.method !== input.method) {
      throw new ApiError(400, `Saved payout method is ${payoutProfile.method}`);
    }

    const activeRequest = await AgencyPayoutRequest.exists({
      ownerAgency: scope.ownerObjectId,
      $or: [
        { reservationActive: true },
        { status: { $in: ["pending", "approved", "processing"] } },
      ],
    });
    if (activeRequest) {
      throw new ApiError(409, "An active payout request already exists");
    }

    const balances = await this.computeBalances(scope.ownerObjectId);
    validateDsaPayoutAmount(amount, balances.availableToRequest);

    let request;
    try {
      request = await AgencyPayoutRequest.create({
        ownerAgency: scope.ownerObjectId,
        requestedBy: new Types.ObjectId(input.agencyId),
        payoutProfile: payoutProfile._id,
        destinationEncryptedSnapshot: payoutProfile.encryptedPayload,
        destinationMasked: payoutProfile.maskedDestination,
        amount,
        method: payoutProfile.method,
        notes: String(input.notes || "").trim() || undefined,
        status: "pending",
        reservationActive: true,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ApiError(409, "An active payout request already exists");
      }
      throw error;
    }

    return request;
  }
}

export const agencyPayoutService = new AgencyPayoutService();
