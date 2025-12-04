import { ClientSession } from "mongoose";
import ApiError from "../utils/ApiError";
import LanderWallet from "../modals/landerWallet.model";
import Lander from "../modals/lander.model";
import PayoutRequest, {
  IPayoutRequest,
  PayoutMethod,
  PayoutStatus,
} from "../modals/payoutRequest.model";
import { WalletService } from "./wallet.service";
import { RazorpayService } from "../config/razorpay";
import { config } from "../config/config";

interface PayoutRequestInput {
  landerId: string;
  amount: number;
  method: PayoutMethod;
  upiId?: string;
  bankDetails?: IPayoutRequest["bankDetails"];
  session?: ClientSession;
}

export class PayoutService {
  async requestPayout({
    landerId,
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
    const wallet = await WalletService.getOrCreateWallet(landerId, session);

    if (wallet.balance - wallet.lockedBalance < amount) {
      throw new ApiError(400, "Insufficient balance for payout");
    }

    wallet.pendingPayout += amount;
    wallet.lockedBalance += amount;
    await wallet.save({ session });

    const request = await PayoutRequest.create(
      [
        {
          lander: landerId,
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

  /**
   * Process payout request and transfer funds to lender
   * 
   * TEST MODE: When config.payment.testMode is true, creates dummy payout results
   * without actually initiating payment via Razorpay. Set PAYOUT_TEST_MODE=false
   * in .env to enable real payments.
   * 
   * PRODUCTION MODE: Actually initiates payment via RazorpayX when test mode is disabled
   */
  async processPayout(payout: IPayoutRequest, session?: ClientSession) {
    const isTestMode = config.payment?.testMode;
    console.log(`🔧 Payout Processing Mode: ${isTestMode ? "TEST MODE (No real payment)" : "PRODUCTION MODE (Real payment)"}`);
    
    // Validate payout destination based on method
    if (payout.method === "upi") {
      if (!payout.upiId) {
        throw new ApiError(400, "UPI ID is required for UPI payout");
      }
    } else if (payout.method === "bank_transfer") {
      if (!payout.bankDetails?.accountNumber || !payout.bankDetails?.ifsc) {
        throw new ApiError(400, "Bank account number and IFSC code are required for bank transfer");
      }
    } else {
      throw new ApiError(400, "Invalid payout method");
    }

    try {
      payout.status = "processing";
      await payout.save({ session });

      const lander = await Lander.findById(payout.lander).lean();

      const payoutReference = (payout._id as any).toString();

      // Build destination based on payout method
      let destination;
      if (payout.method === "upi" && payout.upiId) {
        destination = {
          type: "upi" as const,
          address: payout.upiId,
        };
      } else if (payout.method === "bank_transfer" && payout.bankDetails) {
        destination = {
          type: "bank_account" as const,
          accountNumber: payout.bankDetails.accountNumber!,
          accountHolder: payout.bankDetails.accountHolder || lander?.name || "Lander",
          ifsc: payout.bankDetails.ifsc!,
        };
      } else {
        throw new ApiError(400, "Invalid payout destination configuration");
      }

      // Check if test mode is enabled
      let payoutResult;
      if (config.payment?.testMode) {
        // TEST MODE: Create dummy payout result without actually initiating payment
        console.log("🧪 TEST MODE: Creating dummy payout result");
        console.log("💰 Payout Details:", {
          amount: payout.amount,
          method: payout.method,
          destination: payout.method === "upi" ? payout.upiId : payout.bankDetails,
          lander: lander?.name,
        });

        // Generate dummy IDs that look realistic
        const timestamp = Date.now();
        payoutResult = {
          contactId: `cont_test_${timestamp}`,
          fundAccountId: `fa_test_${timestamp}`,
          payoutId: `pout_test_${timestamp}`,
          status: "processed",
          data: {
            id: `pout_test_${timestamp}`,
            entity: "payout",
            amount: Math.round(payout.amount * 100),
            currency: "INR",
            mode: payout.method === "upi" ? "upi" : "imps",
            status: "processed",
            purpose: "payout",
            reference_id: payoutReference,
            narration: "Agent Commission Payout (TEST MODE)",
            created_at: Math.floor(timestamp / 1000),
          },
        };
        
        console.log("✅ TEST MODE: Dummy payout created successfully");
      } else {
        // PRODUCTION MODE: Actually initiate the payout via Razorpay
        console.log("💳 PRODUCTION MODE: Initiating real payout via Razorpay");
        payoutResult = await RazorpayService.initiateAgentPayout({
          amount: payout.amount,
          contact: {
            name: lander?.name || payout.lander.toString(),
            email: lander?.email,
            contact: lander?.mobile,
          },
          destination,
          referenceId: payoutReference,
          purpose: "payout",
        });
      }

      payout.status = "paid";
      payout.razorpayContactId = payoutResult.contactId;
      payout.razorpayFundAccountId = payoutResult.fundAccountId;
      payout.razorpayPayoutId = payoutResult.payoutId;
      payout.processedAt = new Date();
      await payout.save({ session });

      const wallet = await LanderWallet.findOne({ lander: payout.lander });
      if (wallet) {
        wallet.pendingPayout = Math.max(0, wallet.pendingPayout - payout.amount);
        wallet.lockedBalance = Math.max(0, wallet.lockedBalance - payout.amount);
        await wallet.save({ session });
      }

      await WalletService.debit({
        landerId: payout.lander as any,
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

      const wallet = await LanderWallet.findOne({ lander: payout.lander });
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
