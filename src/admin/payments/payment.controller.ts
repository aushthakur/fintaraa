import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import CommissionRule from "../../modals/commissionRule.model";
import LanderWallet from "../../modals/landerWallet.model";
import WalletTransaction from "../../modals/walletTransaction.model";
import PayoutRequest from "../../modals/payoutRequest.model";
import BankSubscription from "../../modals/bankSubscription.model";
import { commissionService } from "../../services/commission.service";
import { payoutService } from "../../services/payout.service";
import { bankSubscriptionService } from "../../services/bankSubscription.service";
import { CommonService } from "../../services/common.services";

const payoutRequestService = new CommonService(PayoutRequest);
const walletTransactionService = new CommonService(WalletTransaction);

export class PaymentController {
  static async createCommissionRule(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const rule = await CommissionRule.create(req.body);
      res
        .status(201)
        .json(new ApiResponse(201, rule, "Commission rule created"));
    } catch (error) {
      next(error);
    }
  }

  static async getCommissionRules(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const rules = await CommissionRule.find(req.query)
        .sort({ priority: 1 })
        .lean();
      res
        .status(200)
        .json(new ApiResponse(200, rules, "Commission rules"));
    } catch (error) {
      next(error);
    }
  }

  // Record commission for loan query disbursement
  static async recordLoanCommission(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const session = (req as any).mongoSession;
      const result = await commissionService.recordLoanCommission(req.body, session);
      res
        .status(200)
        .json(new ApiResponse(200, result, "Loan commission credited"));
    } catch (error) {
      next(error);
    }
  }

  // Record commission for insurance query completion
  static async recordInsuranceCommission(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const session = (req as any).mongoSession;
      const result = await commissionService.recordInsuranceCommission(req.body, session);
      res
        .status(200)
        .json(new ApiResponse(200, result, "Insurance commission credited"));
    } catch (error) {
      next(error);
    }
  }

  static async getLanderWallet(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const wallet = await LanderWallet.findOne({ lander: req.params.landerId });
      const transactions = await WalletTransaction.find({ lander: req.params.landerId })
        .sort({ createdAt: -1 })
        .limit(Number(req.query.limit) || 50);

      res.status(200).json(
        new ApiResponse(200, { wallet, transactions }, "Wallet details fetched")
      );
    } catch (error) {
      next(error);
    }
  }

  static async listTransactions(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      
      // For landers, only show their own transactions
      if (role === "lander" && userId) {
        req.query.lander = userId;
      }
      // Admin can see all transactions
      
      // Add lookup stages to populate lander details
      const populateStages = [
        {
          $lookup: {
            from: "landers",
            localField: "lander",
            foreignField: "_id",
            as: "landerData",
          },
        },
        {
          $unwind: {
            path: "$landerData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            lander: {
              $cond: {
                if: { $ifNull: ["$landerData", false] },
                then: {
                  _id: "$landerData._id",
                  name: "$landerData.name",
                  email: "$landerData.email",
                  mobile: "$landerData.mobile",
                },
                else: "$lander",
              },
            },
          },
        },
        {
          $project: {
            landerData: 0,
          },
        },
      ];
      
      const transactions = await walletTransactionService.getAll(req.query, populateStages);
      
      res
        .status(200)
        .json(
          new ApiResponse(200, transactions, "Transaction history fetched successfully")
        );
    } catch (error) {
      next(error);
    }
  }

  static async requestPayout(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const session = (req as any).mongoSession;
      const payout = await payoutService.requestPayout({
        landerId: req.body.landerId,
        amount: req.body.amount,
        method: req.body.method,
        upiId: req.body.upiId,
        bankDetails: req.body.bankDetails,
        session,
      });

      res
        .status(201)
        .json(new ApiResponse(201, payout, "Payout request created"));
    } catch (error) {
      next(error);
    }
  }

  static async approvePayout(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const adminId = (req as any).user?._id;
      if (!adminId) throw new ApiError(403, "User context missing");
      const session = (req as any).mongoSession;
      const payout = await payoutService.approvePayout(
        req.params.id,
        adminId,
        session
      );

      res
        .status(200)
        .json(new ApiResponse(200, payout, "Payout processed"));
    } catch (error) {
      next(error);
    }
  }

  static async listPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      
      // For landers, only show their own payout requests
      if (role === "lander" && userId) {
        req.query.lander = userId;
      }
      // Admin can see all payout requests
      
      // Add lookup stages to populate lander and approvedBy
      const populateStages = [
        {
          $lookup: {
            from: "landers",
            localField: "lander",
            foreignField: "_id",
            as: "landerData",
          },
        },
        {
          $unwind: {
            path: "$landerData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "admins",
            localField: "approvedBy",
            foreignField: "_id",
            as: "approvedByData",
          },
        },
        {
          $unwind: {
            path: "$approvedByData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            lander: {
              $cond: {
                if: { $ifNull: ["$landerData", false] },
                then: {
                  _id: "$landerData._id",
                  name: "$landerData.name",
                  email: "$landerData.email",
                  mobile: "$landerData.mobile",
                },
                else: "$lander",
              },
            },
            approvedBy: {
              $cond: {
                if: { $ifNull: ["$approvedByData", false] },
                then: {
                  _id: "$approvedByData._id",
                  name: "$approvedByData.name",
                  email: "$approvedByData.email",
                },
                else: "$approvedBy",
              },
            },
          },
        },
        {
          $project: {
            landerData: 0,
            approvedByData: 0,
          },
        },
      ];
      
      const payouts = await payoutRequestService.getAll(req.query, populateStages);
      
      res
        .status(200)
        .json(new ApiResponse(200, payouts, "Payout requests fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async upsertBankSubscription(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const session = (req as any).mongoSession;
      const subscription = await bankSubscriptionService.upsertSubscription({
        ...req.body,
        session,
      });

      res
        .status(201)
        .json(new ApiResponse(201, subscription, "Subscription saved"));
    } catch (error) {
      next(error);
    }
  }

  static async chargeSubscription(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const session = (req as any).mongoSession;
      const data = await bankSubscriptionService.chargeSubscription(
        req.params.id,
        req.body,
        session
      );

      res
        .status(200)
        .json(new ApiResponse(200, data, "Subscription charged"));
    } catch (error) {
      next(error);
    }
  }

  static async listSubscriptions(
    _req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const subscriptions = await BankSubscription.find().sort({ createdAt: -1 });
      res
        .status(200)
        .json(new ApiResponse(200, subscriptions, "Bank subscriptions"));
    } catch (error) {
      next(error);
    }
  }
}
