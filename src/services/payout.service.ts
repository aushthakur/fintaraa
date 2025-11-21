import { ClientSession } from "mongoose";
import ApiError from "../utils/ApiError";
import AgentWallet from "../modals/agentWallet.model";
import Agent from "../modals/agent.model";
import PayoutRequest, {
  IPayoutRequest,
  PayoutMethod,
  PayoutStatus,
} from "../modals/payoutRequest.model";
import { WalletService } from "./wallet.service";
import { RazorpayService } from "../config/razorpay";

interface PayoutRequestInput {
  agentId: string;
  amount: number;
  method: PayoutMethod;
  upiId?: string;
  bankDetails?: IPayoutRequest["bankDetails"];
  session?: ClientSession;
}

export class PayoutService {
  async requestPayout({
    agentId,
    amount,
    method,
    upiId,
    bankDetails,
    session,
  }: PayoutRequestInput) {
    if (amount <= 0) throw new ApiError(400, "Amount must be greater than 0");
    if (method === "upi" && !upiId) {
      throw new ApiError(400, "UPI ID is required for UPI payouts");
    }
    if (method === "bank_transfer" && !bankDetails?.accountNumber) {
      throw new ApiError(400, "Bank details required for bank transfer payouts");
    }
    const wallet = await WalletService.getOrCreateWallet(agentId, session);

    if (wallet.balance - wallet.lockedBalance < amount) {
      throw new ApiError(400, "Insufficient balance for payout");
    }

    wallet.pendingPayout += amount;
    wallet.lockedBalance += amount;
    await wallet.save({ session });

    const request = await PayoutRequest.create(
      [
        {
          agent: agentId,
          amount,
          method,
          upiId,
          bankDetails,
          status: "pending",
        },
      ],
      { session }
    );

    return request[0];
  }

  async approvePayout(
    payoutId: string,
    adminId: string,
    session?: ClientSession
  ) {
    const payout = await PayoutRequest.findById(payoutId);
    if (!payout) throw new ApiError(404, "Payout request not found");
    if (payout.status !== "pending") {
      throw new ApiError(400, "Payout already processed");
    }

    payout.status = "approved";
    payout.approvedBy = adminId as any;
    payout.approvedAt = new Date();
    await payout.save({ session });

    return await this.processPayout(payout, session);
  }

  async processPayout(payout: IPayoutRequest, session?: ClientSession) {
    if (!payout.upiId && !payout.bankDetails?.accountNumber) {
      throw new ApiError(400, "Payout destination missing");
    }

    try {
      payout.status = "processing";
      await payout.save({ session });

      const agent = await Agent.findById(payout.agent).lean();

      const payoutReference = (payout._id as any).toString();

      const destination = payout.upiId
        ? { type: "upi" as const, address: payout.upiId }
        : {
            type: "bank_account" as const,
            accountNumber: payout.bankDetails?.accountNumber!,
            accountHolder: payout.bankDetails?.accountHolder || "Agent",
            ifsc: payout.bankDetails?.ifsc!,
          };

      const payoutResult = await RazorpayService.initiateAgentPayout({
        amount: payout.amount,
        contact: {
          name: agent?.name || payout.agent.toString(),
          email: agent?.email,
          contact: agent?.mobile,
        },
        destination,
        referenceId: payoutReference,
        purpose: "payout",
      });

      payout.status = "paid";
      payout.razorpayContactId = payoutResult.contactId;
      payout.razorpayFundAccountId = payoutResult.fundAccountId;
      payout.razorpayPayoutId = payoutResult.payoutId;
      payout.processedAt = new Date();
      await payout.save({ session });

      const wallet = await AgentWallet.findOne({ agent: payout.agent });
      if (wallet) {
        wallet.pendingPayout = Math.max(0, wallet.pendingPayout - payout.amount);
        wallet.lockedBalance = Math.max(0, wallet.lockedBalance - payout.amount);
        await wallet.save({ session });
      }

      await WalletService.debit({
        agentId: payout.agent as any,
        amount: payout.amount,
        referenceId: payoutReference,
        description: "Commission payout",
        category: "payout",
        session,
        enforce: false,
        type: "debit",
      });

      return payout;
    } catch (error: any) {
      payout.status = "failed";
      payout.failureReason = error.message;
      await payout.save({ session });

      const wallet = await AgentWallet.findOne({ agent: payout.agent });
      if (wallet) {
        wallet.pendingPayout = Math.max(0, wallet.pendingPayout - payout.amount);
        wallet.lockedBalance = Math.max(0, wallet.lockedBalance - payout.amount);
        await wallet.save({ session });
      }

      throw error;
    }
  }
}

export const payoutService = new PayoutService();
