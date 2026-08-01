import { Types } from "mongoose";
import ApiError from "../utils/ApiError";
import { User, UserStatus } from "../modals/user.model";
import { ReferralEvent } from "../modals/referralEvent.model";
import {
  MAXIMUM_REFERRAL_PAYOUT_AMOUNT,
  MINIMUM_REFERRAL_PAYOUT_AMOUNT,
  ReferralPayoutRequest,
  ReferralPayoutRequestStatus,
} from "../modals/referralPayoutRequest.model";

export {
  MAXIMUM_REFERRAL_PAYOUT_AMOUNT,
  MINIMUM_REFERRAL_PAYOUT_AMOUNT,
};
const POINTS_TO_RUPEE = 100;
const PAYOUT_STATUSES: ReferralPayoutRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "paid",
];

const roundMoney = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : 0;
};

export const calculateReferralWalletBalances = ({
  lifetimeCredited,
  reservedAmount,
  legacyPaidAmount,
  walletPaidAmount,
}: {
  lifetimeCredited: unknown;
  reservedAmount: unknown;
  legacyPaidAmount: unknown;
  walletPaidAmount: unknown;
}) => {
  const lifetime = Math.max(0, roundMoney(lifetimeCredited));
  const reserved = Math.max(0, roundMoney(reservedAmount));
  const legacyPaid = Math.max(0, roundMoney(legacyPaidAmount));
  const walletPaid = Math.max(0, roundMoney(walletPaidAmount));
  const paidAmount = roundMoney(legacyPaid + walletPaid);
  const availableAmount = Math.max(
    0,
    roundMoney(lifetime - reserved - paidAmount),
  );

  return {
    lifetimeCredited: lifetime,
    reservedAmount: reserved,
    paidAmount,
    availableAmount,
    legacyPaidAmount: legacyPaid,
    walletPaidAmount: walletPaid,
  };
};

export const validateReferralPayoutAmount = (
  rawAmount: unknown,
  availableAmount: number,
): number => {
  const parsed = Number(rawAmount);
  if (!Number.isFinite(parsed) || parsed < MINIMUM_REFERRAL_PAYOUT_AMOUNT) {
    throw new ApiError(
      400,
      `Payout amount must be at least ₹${MINIMUM_REFERRAL_PAYOUT_AMOUNT}`,
    );
  }
  const amount = roundMoney(parsed);
  if (Math.abs(parsed - amount) > 0.000001) {
    throw new ApiError(400, "Payout amount can have at most two decimal places");
  }
  if (amount > MAXIMUM_REFERRAL_PAYOUT_AMOUNT) {
    throw new ApiError(
      400,
      `Payout amount cannot exceed ₹${MAXIMUM_REFERRAL_PAYOUT_AMOUNT.toLocaleString(
        "en-IN",
      )}`,
    );
  }
  if (amount > roundMoney(availableAmount)) {
    throw new ApiError(
      400,
      `Insufficient referral balance. You can request up to ₹${roundMoney(
        availableAmount,
      ).toFixed(2)}`,
    );
  }
  return amount;
};

const actorRow = (actor: any) => {
  if (!actor) return undefined;
  if (typeof actor !== "object" || !actor._id) return { id: String(actor) };
  return {
    id: String(actor._id),
    name: actor.name,
    email: actor.email,
  };
};

export const mapReferralPayoutRequest = (request: any) => {
  const user = request?.user;
  const status = String(request?.status || "pending");
  const adminNote =
    status === "paid"
      ? request?.paymentNote
      : status === "rejected"
        ? request?.rejectionNote
        : request?.approvalNote;

  return {
    id: String(request?._id || request?.id || ""),
    amount: roundMoney(request?.amount),
    status,
    fundsReserved: request?.fundsReserved === true,
    adminReference: request?.adminReference || undefined,
    adminNote: adminNote || undefined,
    approvalNote: request?.approvalNote || undefined,
    rejectionNote: request?.rejectionNote || undefined,
    paymentNote: request?.paymentNote || undefined,
    createdAt: request?.createdAt,
    approvedAt: request?.approvedAt,
    rejectedAt: request?.rejectedAt,
    paidAt: request?.paidAt,
    updatedAt: request?.updatedAt,
    ...(user && typeof user === "object" && user._id
      ? {
          user: {
            id: String(user._id),
            name: user.name,
            mobile: user.mobile,
            customerId: user.customerId,
            referralCode: user.referralCode,
          },
        }
      : {}),
    approvedBy: actorRow(request?.approvedBy),
    rejectedBy: actorRow(request?.rejectedBy),
    paidBy: actorRow(request?.paidBy),
  };
};

const isDuplicateKeyError = (error: any) =>
  error?.code === 11000 || error?.errorResponse?.code === 11000;

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class ReferralWalletService {
  private async getActiveUser(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new ApiError(401, "Valid user session required");
    }
    const user = await User.findOne({
      _id: userId,
      role: "user",
      status: UserStatus.ACTIVE,
      isDeleted: { $ne: true },
    })
      .select("_id name mobile customerId referralCode referralPoints")
      .lean();
    if (!user) throw new ApiError(403, "Active user account required");
    return user;
  }

  private async computeWallet(user: any) {
    const userObjectId = new Types.ObjectId(String(user._id));
    const [legacyPaid, requestTotals, activeRequest] = await Promise.all([
      ReferralEvent.aggregate([
        {
          $match: {
            referrer: userObjectId,
            payoutStatus: "paid",
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ["$rewardAmount", 0] }, 0] },
                  "$rewardAmount",
                  {
                    $divide: [
                      { $ifNull: ["$points", 0] },
                      POINTS_TO_RUPEE,
                    ],
                  },
                ],
              },
            },
          },
        },
      ]),
      ReferralPayoutRequest.aggregate([
        { $match: { user: userObjectId } },
        {
          $group: {
            _id: null,
            reservedAmount: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["pending", "approved"]] },
                  "$amount",
                  0,
                ],
              },
            },
            walletPaidAmount: {
              $sum: {
                $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0],
              },
            },
          },
        },
      ]),
      ReferralPayoutRequest.findOne({
        user: userObjectId,
        fundsReserved: true,
        status: { $in: ["pending", "approved"] },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const balances = calculateReferralWalletBalances({
      lifetimeCredited:
        Math.max(0, Number(user.referralPoints || 0)) / POINTS_TO_RUPEE,
      reservedAmount: requestTotals?.[0]?.reservedAmount,
      legacyPaidAmount: legacyPaid?.[0]?.total,
      walletPaidAmount: requestTotals?.[0]?.walletPaidAmount,
    });
    return { balances, activeRequest };
  }

  async getSummary(userId: string) {
    const user = await this.getActiveUser(userId);
    const { balances, activeRequest } = await this.computeWallet(user);
    return {
      ...balances,
      minimumPayoutAmount: MINIMUM_REFERRAL_PAYOUT_AMOUNT,
      canRequestPayout:
        !activeRequest &&
        balances.availableAmount >= MINIMUM_REFERRAL_PAYOUT_AMOUNT,
      activeRequest: activeRequest
        ? mapReferralPayoutRequest(activeRequest)
        : null,
    };
  }

  async listUserRequests(input: {
    userId: string;
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const user = await this.getActiveUser(input.userId);
    const page = Math.max(Number(input.page || 1), 1);
    const limit = Math.min(Math.max(Number(input.limit || 20), 1), 100);
    const filter: Record<string, any> = { user: user._id };
    if (input.status) {
      if (!PAYOUT_STATUSES.includes(input.status as ReferralPayoutRequestStatus)) {
        throw new ApiError(400, "Invalid referral payout status");
      }
      filter.status = input.status;
    }

    const [requests, totalItems] = await Promise.all([
      ReferralPayoutRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ReferralPayoutRequest.countDocuments(filter),
    ]);
    return {
      result: requests.map(mapReferralPayoutRequest),
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
        itemsPerPage: limit,
      },
    };
  }

  async createRequest(userId: string, rawAmount: unknown) {
    const user = await this.getActiveUser(userId);
    const { balances, activeRequest } = await this.computeWallet(user);
    if (activeRequest) {
      throw new ApiError(409, "An active referral payout request already exists");
    }
    const amount = validateReferralPayoutAmount(
      rawAmount,
      balances.availableAmount,
    );

    try {
      const request = await ReferralPayoutRequest.create({
        user: user._id,
        amount,
        status: "pending",
        fundsReserved: true,
      });
      return mapReferralPayoutRequest(request.toObject());
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ApiError(
          409,
          "An active referral payout request already exists",
        );
      }
      throw error;
    }
  }

  async listAdminRequests(input: {
    page?: number;
    limit?: number;
    status?: string;
    userId?: string;
    search?: string;
  }) {
    const page = Math.max(Number(input.page || 1), 1);
    const limit = Math.min(Math.max(Number(input.limit || 20), 1), 100);
    const filter: Record<string, any> = {};
    if (input.status && input.status !== "all") {
      if (!PAYOUT_STATUSES.includes(input.status as ReferralPayoutRequestStatus)) {
        throw new ApiError(400, "Invalid referral payout status");
      }
      filter.status = input.status;
    }
    if (input.userId) {
      if (!Types.ObjectId.isValid(input.userId)) {
        throw new ApiError(400, "Invalid user id");
      }
      filter.user = new Types.ObjectId(input.userId);
    }
    const search = String(input.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const matchingUsers = await User.find({
        role: "user",
        $or: [
          { name: regex },
          { mobile: regex },
          { customerId: regex },
          { referralCode: regex },
        ],
      })
        .select("_id")
        .lean();
      const matchingIds = matchingUsers.map((item) => item._id);
      filter.user = filter.user
        ? { $in: matchingIds.filter((id) => String(id) === String(input.userId)) }
        : { $in: matchingIds };
    }

    const [requests, totalItems, summaryRows] = await Promise.all([
      ReferralPayoutRequest.find(filter)
        .populate("user", "name mobile customerId referralCode")
        .populate("approvedBy", "name email")
        .populate("rejectedBy", "name email")
        .populate("paidBy", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ReferralPayoutRequest.countDocuments(filter),
      ReferralPayoutRequest.aggregate([
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            pendingRequests: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            approvedRequests: {
              $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
            },
            rejectedRequests: {
              $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
            },
            paidRequests: {
              $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
            },
            totalRequestedAmount: { $sum: "$amount" },
            reservedAmount: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["pending", "approved"]] },
                  "$amount",
                  0,
                ],
              },
            },
            paidAmount: {
              $sum: {
                $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0],
              },
            },
          },
        },
      ]),
    ]);
    const summary = summaryRows?.[0] || {};
    return {
      result: requests.map(mapReferralPayoutRequest),
      summary: {
        totalRequests: Number(summary.totalRequests || 0),
        pendingRequests: Number(summary.pendingRequests || 0),
        approvedRequests: Number(summary.approvedRequests || 0),
        rejectedRequests: Number(summary.rejectedRequests || 0),
        paidRequests: Number(summary.paidRequests || 0),
        totalRequestedAmount: roundMoney(summary.totalRequestedAmount),
        reservedAmount: roundMoney(summary.reservedAmount),
        paidAmount: roundMoney(summary.paidAmount),
      },
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
        itemsPerPage: limit,
      },
    };
  }

  private async populatedRequestById(id: string) {
    return ReferralPayoutRequest.findById(id)
      .populate("user", "name mobile customerId referralCode")
      .populate("approvedBy", "name email")
      .populate("rejectedBy", "name email")
      .populate("paidBy", "name email")
      .lean();
  }

  private async populatedRequestDocument(request: any) {
    await request.populate([
      { path: "user", select: "name mobile customerId referralCode" },
      { path: "approvedBy", select: "name email" },
      { path: "rejectedBy", select: "name email" },
      { path: "paidBy", select: "name email" },
    ]);
    return request.toObject();
  }

  private validateIds(requestId: string, adminId: string) {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new ApiError(400, "Invalid payout request id");
    }
    if (!Types.ObjectId.isValid(adminId)) {
      throw new ApiError(401, "Valid admin session required");
    }
  }

  async approve(requestId: string, adminId: string, rawNote?: unknown) {
    this.validateIds(requestId, adminId);
    const approvalNote = String(rawNote || "").trim().slice(0, 500);
    const updated = await ReferralPayoutRequest.findOneAndUpdate(
      { _id: requestId, status: "pending", fundsReserved: true },
      {
        $set: {
          status: "approved",
          approvedBy: adminId,
          approvedAt: new Date(),
          approvalNote: approvalNote || undefined,
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) {
      const existing: any = await this.populatedRequestById(requestId);
      if (!existing) throw new ApiError(404, "Payout request not found");
      if (existing.status === "approved") {
        return { request: mapReferralPayoutRequest(existing), changed: false };
      }
      throw new ApiError(409, `Cannot approve a ${existing.status} request`);
    }
    const populated: any = await this.populatedRequestDocument(updated);
    return { request: mapReferralPayoutRequest(populated), changed: true };
  }

  async reject(requestId: string, adminId: string, rawNote: unknown) {
    this.validateIds(requestId, adminId);
    const rejectionNote = String(rawNote || "").trim().slice(0, 500);
    if (!rejectionNote) throw new ApiError(400, "Rejection note is required");
    const updated = await ReferralPayoutRequest.findOneAndUpdate(
      {
        _id: requestId,
        status: { $in: ["pending", "approved"] },
        fundsReserved: true,
      },
      {
        $set: {
          status: "rejected",
          fundsReserved: false,
          rejectedBy: adminId,
          rejectedAt: new Date(),
          rejectionNote,
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) {
      const existing: any = await this.populatedRequestById(requestId);
      if (!existing) throw new ApiError(404, "Payout request not found");
      if (existing.status === "rejected") {
        return { request: mapReferralPayoutRequest(existing), changed: false };
      }
      throw new ApiError(409, `Cannot reject a ${existing.status} request`);
    }
    const populated: any = await this.populatedRequestDocument(updated);
    return { request: mapReferralPayoutRequest(populated), changed: true };
  }

  async markPaid(input: {
    requestId: string;
    adminId: string;
    adminReference: unknown;
    adminNote: unknown;
  }) {
    this.validateIds(input.requestId, input.adminId);
    const adminReference = String(input.adminReference || "")
      .trim()
      .slice(0, 120);
    const paymentNote = String(input.adminNote || "").trim().slice(0, 500);
    if (!adminReference) {
      throw new ApiError(400, "Manual payout reference is required");
    }
    if (!paymentNote) throw new ApiError(400, "Payment note is required");

    const updated = await ReferralPayoutRequest.findOneAndUpdate(
      {
        _id: input.requestId,
        status: "approved",
        fundsReserved: true,
      },
      {
        $set: {
          status: "paid",
          fundsReserved: false,
          adminReference,
          paymentNote,
          paidBy: input.adminId,
          paidAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) {
      const existing: any = await this.populatedRequestById(input.requestId);
      if (!existing) throw new ApiError(404, "Payout request not found");
      if (existing.status === "paid") {
        return { request: mapReferralPayoutRequest(existing), changed: false };
      }
      throw new ApiError(409, `Cannot mark a ${existing.status} request paid`);
    }
    const populated: any = await this.populatedRequestDocument(updated);
    return { request: mapReferralPayoutRequest(populated), changed: true };
  }
}

export const referralWalletService = new ReferralWalletService();
