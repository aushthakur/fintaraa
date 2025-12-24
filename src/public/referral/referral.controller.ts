import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { ReferralEvent } from "../../modals/referralEvent.model";
import { User } from "../../modals/user.model";

const POINTS_TO_RUPEE = 100;

export class ReferralController {
  static async getSummary(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const user = await User.findById(userId).select("referralCode referralPoints");
      if (!user) return res.status(404).json(new ApiError(404, "User not found"));

      const [pendingCount, rewardedCount] = await Promise.all([
        ReferralEvent.countDocuments({ referrer: userId, status: "pending" }),
        ReferralEvent.countDocuments({ referrer: userId, status: "rewarded" }),
      ]);

      const points = user.referralPoints || 0;
      const amount = points / POINTS_TO_RUPEE;

      return res.status(200).json(
        new ApiResponse(200, {
          referralCode: user.referralCode,
          points,
          amount,
          conversionRate: POINTS_TO_RUPEE,
          pendingCount,
          rewardedCount,
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
        status: event.status,
        points: event.points,
        createdAt: event.createdAt,
        referredUser: {
          name: event.referredUser?.name || "New user",
          mobile: event.referredUser?.mobile,
        },
      }));

      return res
        .status(200)
        .json(new ApiResponse(200, mapped, "Referral history fetched"));
    } catch (err) {
      next(err);
    }
  }
}
