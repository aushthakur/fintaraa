import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { ReferralEvent } from "../../modals/referralEvent.model";
import ApiError from "../../utils/ApiError";
import { ReferralProgramConfig } from "../../modals/referralProgramConfig.model";
import { getReferralProgramConfig } from "../../services/referral.service";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";
import { referralWalletService } from "../../services/referralWallet.service";

const notifyPayoutStatus = async (
  type: string,
  request: any,
  context: Record<string, string | number>,
) => {
  const userId = String(request?.user?.id || "");
  if (!userId) return;
  await sendSingleNotification({
    type,
    toUserId: userId,
    toRole: UserType.USER,
    context,
  }).catch((error: any) =>
    console.log(
      `[Notification] Failed to send ${type}: ${error?.message || error}`,
    ),
  );
};

export class AdminReferralController {
  static async listPayoutRequests(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await referralWalletService.listAdminRequests({
        page: Number(req.query?.page),
        limit: Number(req.query?.limit),
        status: req.query?.status ? String(req.query.status) : undefined,
        userId: req.query?.userId ? String(req.query.userId) : undefined,
        search: req.query?.search ? String(req.query.search) : undefined,
      });
      return res.status(200).json(
        new ApiResponse(
          200,
          result,
          "Referral payout requests fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async approvePayoutRequest(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await referralWalletService.approve(
        req.params.id,
        String(req.user?._id || ""),
        req.body?.adminNote,
      );
      if (result.changed) {
        await notifyPayoutStatus("referral-payout-approved", result.request, {
          amount: result.request.amount,
        });
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result.request, "Payout request approved"));
    } catch (error) {
      next(error);
    }
  }

  static async rejectPayoutRequest(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await referralWalletService.reject(
        req.params.id,
        String(req.user?._id || ""),
        req.body?.adminNote,
      );
      if (result.changed) {
        await notifyPayoutStatus("referral-payout-rejected", result.request, {
          amount: result.request.amount,
          note: result.request.adminNote || "",
        });
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result.request, "Payout request rejected"));
    } catch (error) {
      next(error);
    }
  }

  static async markPayoutRequestPaid(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await referralWalletService.markPaid({
        requestId: req.params.id,
        adminId: String(req.user?._id || ""),
        adminReference: req.body?.adminReference,
        adminNote: req.body?.adminNote,
      });
      if (result.changed) {
        await notifyPayoutStatus("referral-payout-paid", result.request, {
          amount: result.request.amount,
          payoutReference: result.request.adminReference || "",
        });
      }
      return res.status(200).json(
        new ApiResponse(
          200,
          result.request,
          "Payout request marked paid",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 20, 1);
      const search = String(req.query.search || "").trim();
      const status = String(req.query.status || "").trim();
      const lifecycleStage = String(req.query.lifecycleStage || "").trim();
      const payoutStatus = String(req.query.payoutStatus || "").trim();
      const skip = (page - 1) * limit;

      const query: Record<string, any> = {};
      if (status && status !== "all") query.status = status;
      if (lifecycleStage && lifecycleStage !== "all") {
        query.lifecycleStage = lifecycleStage;
      }
      if (payoutStatus && payoutStatus !== "all") {
        query.payoutStatus = payoutStatus;
      }
      if (search) {
        query.referralCode = { $regex: search, $options: "i" };
      }

      const [events, totalItems, pendingPayouts, paidPayouts, creditedAmount, paidAmount, program] = await Promise.all([
        ReferralEvent.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("referrer", "name mobile customerId referralCode")
          .populate("referredUser", "name mobile customerId")
          .populate("loanQuery", "loanId loanType status disbursedAmount")
          .populate("paidBy", "name email")
          .lean(),
        ReferralEvent.countDocuments(query),
        ReferralEvent.countDocuments({
          payoutStatus: "pending",
          rewardCreditedAt: { $type: "date" },
        }),
        ReferralEvent.countDocuments({ payoutStatus: "paid" }),
        ReferralEvent.aggregate([
          {
            $match: {
              status: "rewarded",
              rewardCreditedAt: { $type: "date" },
            },
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$rewardAmount", 0] } } } },
        ]),
        ReferralEvent.aggregate([
          { $match: { payoutStatus: "paid" } },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$rewardAmount", 0] } } } },
        ]),
        getReferralProgramConfig(),
      ]);

      const result = events.map((event: any) => ({
        _id: event._id,
        referralCode: event.referralCode,
        status: event.status,
        points: event.points,
        lifecycleStage: event.lifecycleStage || "registered",
        payoutStatus:
          event.payoutStatus ||
          (event.status === "rewarded" ? "pending" : "not_eligible"),
        rewardAmount: event.rewardAmount || 0,
        disbursedAmount: event.disbursedAmount || 0,
        registeredAt: event.registeredAt || event.createdAt,
        appliedAt: event.appliedAt,
        approvedAt: event.approvedAt,
        disbursedAt: event.disbursedAt,
        rewardCreditedAt: event.rewardCreditedAt,
        paidAt: event.paidAt,
        paidBy: event.paidBy?._id || event.paidBy,
        paidByName: event.paidBy?.name || event.paidBy?.email,
        payoutReference: event.payoutReference,
        payoutNote: event.payoutNote,
        loanId: event.loanQuery?.loanId || "-",
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        referrerName: event.referrer?.name || "-",
        referrerMobile: event.referrer?.mobile || "-",
        referrerCustomerId: event.referrer?.customerId || "-",
        referredUserName: event.referredUser?.name || "-",
        referredUserMobile: event.referredUser?.mobile || "-",
        referredUserCustomerId: event.referredUser?.customerId || "-",
      }));

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            result,
            summary: {
              totalReferrals: await ReferralEvent.countDocuments(),
              pendingPayouts,
              paidPayouts,
              creditedAmount: Number(creditedAmount?.[0]?.total || 0),
              paidAmount: Number(paidAmount?.[0]?.total || 0),
            },
            program,
            pagination: {
              totalPages: Math.max(Math.ceil(totalItems / limit), 1),
              totalItems,
              currentPage: page,
              itemsPerPage: limit,
            },
          },
          "Referral events fetched successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getConfig(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const program = await getReferralProgramConfig();
      return res
        .status(200)
        .json(new ApiResponse(200, program, "Referral program fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async updateConfig(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const rewardAmount = Number(req.body?.rewardAmount);
      const minimumDisbursementAmount = Number(
        req.body?.minimumDisbursementAmount,
      );
      if (!Number.isFinite(rewardAmount) || rewardAmount < 1) {
        throw new ApiError(400, "Reward amount must be at least ₹1");
      }
      if (
        !Number.isFinite(minimumDisbursementAmount) ||
        minimumDisbursementAmount < 0
      ) {
        throw new ApiError(
          400,
          "Minimum disbursement amount cannot be negative",
        );
      }
      const program = await ReferralProgramConfig.findOneAndUpdate(
        { singletonKey: "default" },
        {
          $set: {
            rewardAmount,
            minimumDisbursementAmount,
            isActive: req.body?.isActive !== false,
            updatedBy: req.user?._id,
          },
          $setOnInsert: { singletonKey: "default" },
        },
        { new: true, upsert: true, runValidators: true },
      );
      return res
        .status(200)
        .json(new ApiResponse(200, program, "Referral program updated"));
    } catch (error) {
      next(error);
    }
  }

  static async processPayout(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      throw new ApiError(
        410,
        "Direct event payouts are disabled. Use referral payout requests.",
      );
    } catch (error) {
      next(error);
    }
  }
}
