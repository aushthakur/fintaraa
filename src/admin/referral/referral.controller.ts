import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { ReferralEvent } from "../../modals/referralEvent.model";

export class AdminReferralController {
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 20, 1);
      const search = String(req.query.search || "").trim();
      const status = String(req.query.status || "").trim();
      const skip = (page - 1) * limit;

      const query: Record<string, any> = {};
      if (status && status !== "all") query.status = status;
      if (search) {
        query.referralCode = { $regex: search, $options: "i" };
      }

      const [events, totalItems] = await Promise.all([
        ReferralEvent.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("referrer", "name mobile customerId referralCode")
          .populate("referredUser", "name mobile customerId")
          .lean(),
        ReferralEvent.countDocuments(query),
      ]);

      const result = events.map((event: any) => ({
        _id: event._id,
        referralCode: event.referralCode,
        status: event.status,
        points: event.points,
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
}
