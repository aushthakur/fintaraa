import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Plan } from "./../../modals/subscription.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const SubscriptionService = new CommonService(Plan);

export class SubscriptionController {
  static async createSubscription(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await SubscriptionService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Subscription"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllSubscriptions(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await SubscriptionService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPublicSubscriptions(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id: userId } = (req as any).user || {};
      const query = { ...req.query };

      let pipeline: any[] = [];

      if (userId) {
        pipeline.push(
          {
            $lookup: {
              from: "bookingenrollments",
              let: { planId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$planId", "$$planId"] },
                        {
                          $eq: ["$userId", new mongoose.Types.ObjectId(userId)],
                        },
                      ],
                    },
                  },
                },
              ],
              as: "userEnrollments",
            },
          },
          {
            $addFields: {
              isPurchased: {
                $gt: [{ $size: "$userEnrollments" }, 0],
              },
              hasFuturePurchase: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: "$userEnrollments",
                        as: "enroll",
                        cond: { $gt: ["$$enroll.startDate", new Date()] },
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
          {
            $project: {
              userEnrollments: 0,
            },
          }
        );
      }

      const result = await SubscriptionService.getAll(query, pipeline);

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getSubscriptionById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await SubscriptionService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Subscription not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateSubscriptionById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await SubscriptionService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Subscription"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteSubscriptionById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await SubscriptionService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Subscription"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
