import { NextFunction, Request, Response } from "express";
import {
  CommunicationChannel,
  CommunicationOutbox,
  CommunicationOutboxStatus,
} from "../../modals/communicationOutbox.model";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const positiveInteger = (value: unknown, fallback: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
};

export class CommunicationOutboxController {
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = positiveInteger(req.query.page, 1, 100_000);
      const limit = positiveInteger(req.query.limit, 25, 100);
      const query: Record<string, any> = {};
      const status = String(req.query.status || "").trim();
      const channel = String(req.query.channel || "").trim();
      const referenceId = String(req.query.referenceId || "").trim();
      const search = String(req.query.search || "").trim();

      if (
        Object.values(CommunicationOutboxStatus).includes(
          status as CommunicationOutboxStatus,
        )
      ) {
        query.status = status;
      }
      if (
        Object.values(CommunicationChannel).includes(
          channel as CommunicationChannel,
        )
      ) {
        query.channel = channel;
      }
      if (referenceId) query.referenceId = referenceId;
      if (search) {
        const regex = new RegExp(escapeRegExp(search), "i");
        query.$or = [
          { recipient: regex },
          { eventName: regex },
          { referenceId: regex },
        ];
      }

      const [items, total, statusCounts] = await Promise.all([
        CommunicationOutbox.find(query)
          .select("-payload")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        CommunicationOutbox.countDocuments(query),
        CommunicationOutbox.aggregate([
          { $match: query },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
      ]);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            items,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
            statusCounts: Object.fromEntries(
              statusCounts.map((item) => [item._id, item.count]),
            ),
          },
          "Communication delivery status fetched successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async retry(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await CommunicationOutbox.findOneAndUpdate(
        {
          _id: req.params.id,
          status: CommunicationOutboxStatus.FAILED,
        },
        {
          $set: {
            status: CommunicationOutboxStatus.PENDING,
            attempts: 0,
            nextAttemptAt: new Date(),
            lastError: "",
          },
          $unset: {
            lockedAt: 1,
            sentAt: 1,
            deliveredAt: 1,
            readAt: 1,
            providerMessageId: 1,
            providerStatus: 1,
          },
        },
        { new: true },
      )
        .select("-payload")
        .lean();

      if (!job) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed communication was not found."));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, job, "Communication queued for retry"));
    } catch (error) {
      next(error);
    }
  }
}
