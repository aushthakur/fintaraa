import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { ReferralEvent } from "../../modals/referralEvent.model";
import { ReferralVisit } from "../../modals/referralVisit.model";
import { User } from "../../modals/user.model";
import { getReferralProgramConfig } from "../../services/referral.service";
import {
  ensureUserReferralCode,
  findEligibleReferrerByCode,
} from "../../services/referralAttribution.service";
import { normalizeReferralCode } from "../../utils/referral";
import { referralWalletService } from "../../services/referralWallet.service";

const POINTS_TO_RUPEE = 100;

export class ReferralController {
  static async getWallet(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = String(req.user?._id || "");
      const result = await referralWalletService.getSummary(userId);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Referral wallet fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async listPayoutRequests(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await referralWalletService.listUserRequests({
        userId: String(req.user?._id || ""),
        page: Number(req.query?.page),
        limit: Number(req.query?.limit),
        status: req.query?.status ? String(req.query.status) : undefined,
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

  static async createPayoutRequest(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await referralWalletService.createRequest(
        String(req.user?._id || ""),
        req.body?.amount,
      );
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Referral payout requested"));
    } catch (error) {
      next(error);
    }
  }

  static async getSummary(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const user = await User.findById(userId).select("referralCode referralPoints");
      if (!user) return res.status(404).json(new ApiError(404, "User not found"));
      if (!user.referralCode) {
        await ensureUserReferralCode(user);
      }

      const [pendingCount, rewardedCount, paidCount, totalReferrals, visitCount, program] = await Promise.all([
        ReferralEvent.countDocuments({
          referrer: userId,
          $or: [
            { status: "pending" },
            {
              status: "rewarded",
              rewardCreditedAt: { $exists: false },
            },
          ],
        }),
        ReferralEvent.countDocuments({
          referrer: userId,
          status: "rewarded",
          rewardCreditedAt: { $type: "date" },
        }),
        ReferralEvent.countDocuments({ referrer: userId, payoutStatus: "paid" }),
        ReferralEvent.countDocuments({ referrer: userId }),
        ReferralVisit.countDocuments({
          referrer: userId,
          recordType: "referral_visit",
        }),
        getReferralProgramConfig(),
      ]);

      const points = user.referralPoints || 0;
      // referralPoints is the idempotently credited ledger total and remains
      // correct for a mix of legacy and v2 referral events.
      const amount = points / POINTS_TO_RUPEE;

      return res.status(200).json(
        new ApiResponse(200, {
          referralCode: user.referralCode,
          totalReferrals,
          successfulReferrals: rewardedCount,
          pendingReferrals: pendingCount,
          totalEarnings: amount,
          visitCount,
          points,
          amount,
          conversionRate: POINTS_TO_RUPEE,
          pendingCount,
          rewardedCount,
          paidCount,
          rewardAmount: program?.rewardAmount || 500,
          minimumDisbursementAmount:
            program?.minimumDisbursementAmount || 0,
          programActive: program?.isActive !== false,
        }, "Referral summary fetched successfully")
      );
    } catch (err) {
      next(err);
    }
  }

  static async getHistory(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const status = req.query?.status as string | undefined;
      const query: any = { referrer: userId };
      if (status) query.status = status;

      const events = await ReferralEvent.find(query)
        .sort({ createdAt: -1 })
        .populate("referredUser", "name mobile")
        .lean();

      const mapped = events.map((event: any) => ({
        id: event._id,
        status: event.lifecycleStage || "registered",
        lifecycleStage: event.lifecycleStage || "registered",
        payoutStatus: event.payoutStatus ||
          (event.status === "rewarded" ? "pending" : "not_eligible"),
        points: event.points,
        rewardAmount:
          event.rewardAmount ?? (event.points || 0) / POINTS_TO_RUPEE,
        disbursedAmount: event.disbursedAmount,
        conversionStatus:
          event.payoutStatus === "paid"
            ? "Reward Paid"
            : event.status === "rewarded"
              ? "Approved"
              : event.lifecycleStage === "applied"
                ? "Applied"
                : "Registered",
        createdAt: event.createdAt,
        registeredAt: event.registeredAt || event.createdAt,
        appliedAt: event.appliedAt,
        approvedAt: event.approvedAt,
        rewardCreditedAt: event.rewardCreditedAt,
        paidAt: event.paidAt,
        referredUser: {
          name: event.referredUser?.name || "New user",
          mobile: event.referredUser?.mobile
            ? `******${String(event.referredUser.mobile).slice(-4)}`
            : undefined,
        },
      }));

      return res
        .status(200)
        .json(new ApiResponse(200, mapped, "Referral history fetched"));
    } catch (err) {
      next(err);
    }
  }

  static async trackVisit(req: Request, res: Response, next: NextFunction) {
    try {
      const referralCode = normalizeReferralCode(
        req.body?.referralCode || req.query?.ref,
      );
      if (!referralCode) {
        return res
          .status(400)
          .json(new ApiError(400, "Referral code is required"));
      }

      const referrer = await findEligibleReferrerByCode(referralCode);
      if (!referrer) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid or inactive referral code"));
      }
      const visit = await ReferralVisit.create({
        recordType: "referral_visit",
        referralCode,
        referrer: referrer._id,
        visitorId: String(req.body?.visitorId || "").trim(),
        landingPath: String(req.body?.landingPath || "").trim(),
        source: String(req.body?.source || "website").trim(),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || "",
      });

      return res
        .status(201)
        .json(new ApiResponse(201, visit, "Referral visit tracked"));
    } catch (err) {
      next(err);
    }
  }
}
