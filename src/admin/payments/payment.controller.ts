import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import CommissionRule from "../../modals/commissionRule.model";
import AgentWallet from "../../modals/agentWallet.model";
import WalletTransaction from "../../modals/walletTransaction.model";
import PayoutRequest from "../../modals/payoutRequest.model";
import BankSubscription from "../../modals/bankSubscription.model";
import { commissionService } from "../../services/commission.service";
import { payoutService } from "../../services/payout.service";
import { bankSubscriptionService } from "../../services/bankSubscription.service";

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

  static async recordDisbursement(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const session = (req as any).mongoSession;
      const result = await commissionService.recordCommission(req.body, session);
      res
        .status(200)
        .json(new ApiResponse(200, result, "Commission credited"));
    } catch (error) {
      next(error);
    }
  }

  static async getAgentWallet(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const wallet = await AgentWallet.findOne({ agent: req.params.agentId });
      const transactions = await WalletTransaction.find({ agent: req.params.agentId })
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
      const query: Record<string, any> = {};
      if (req.query.agentId) query.agent = req.query.agentId;
      if (req.query.category) query.category = req.query.category;
      const transactions = await WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .limit(Number(req.query.limit) || 100)
        .lean();

      res
        .status(200)
        .json(
          new ApiResponse(200, transactions, "Transaction history fetched")
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
        agentId: req.body.agentId,
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
      const payouts = await PayoutRequest.find(req.query)
        .sort({ createdAt: -1 })
        .lean();
      res
        .status(200)
        .json(new ApiResponse(200, payouts, "Payout requests"));
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
