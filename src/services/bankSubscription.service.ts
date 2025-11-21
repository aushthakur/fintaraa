import { ClientSession } from "mongoose";
import BankSubscription from "../modals/bankSubscription.model";
import ApiError from "../utils/ApiError";
import { RazorpayService } from "../config/razorpay";

interface SubscriptionInput {
  bankName: string;
  contactEmail: string;
  billingModel: "subscription" | "pay_per_lead";
  amount: number;
  currency?: string;
  billingCycle?: "monthly" | "quarterly" | "yearly" | "per_lead";
  leadsIncluded?: number;
  razorpayCustomerId?: string;
  autopayTokenId?: string;
  session?: ClientSession;
}

export class BankSubscriptionService {
  async upsertSubscription(input: SubscriptionInput) {
    const subscription = await BankSubscription.findOneAndUpdate(
      { bankName: input.bankName, contactEmail: input.contactEmail },
      {
        $set: {
          billingModel: input.billingModel,
          amount: input.amount,
          currency: input.currency || "INR",
          billingCycle: input.billingCycle ||
            (input.billingModel === "pay_per_lead" ? "per_lead" : "monthly"),
          leadsIncluded: input.leadsIncluded,
          razorpayCustomerId: input.razorpayCustomerId,
          autopayTokenId: input.autopayTokenId,
          status: "active",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, session: input.session }
    );
    return subscription;
  }

  async chargeSubscription(
    subscriptionId: string,
    options: { usageCount?: number; forceAmount?: number },
    session?: ClientSession
  ) {
    const subscription = await BankSubscription.findById(subscriptionId);
    if (!subscription) throw new ApiError(404, "Subscription not found");
    if (!subscription.razorpayCustomerId) {
      throw new ApiError(400, "Razorpay customer ID missing for subscription");
    }

    const amount = options.forceAmount ||
      (subscription.billingModel === "pay_per_lead"
        ? (subscription.amount || 0) * (options.usageCount || 1)
        : subscription.amount);

    const charge = await RazorpayService.chargeAutoPay({
      customerId: subscription.razorpayCustomerId || "",
      amount,
      tokenId: subscription.autopayTokenId,
      receipt: `bank_sub_${subscription._id}_${Date.now()}`,
      notes: {
        bank: subscription.bankName,
        billingModel: subscription.billingModel,
      },
    });

    subscription.billingHistory.unshift({
      amount,
      currency: subscription.currency,
      status: charge.success ? "paid" : "failed",
      referenceId: charge?.data?.id,
      chargedAt: new Date(),
      notes: charge.success ? charge.data : { error: charge.message },
    });

    subscription.nextBillingDate = this.computeNextBillingDate(subscription);
    await subscription.save({ session });

    if (!charge.success) {
      throw new ApiError(400, charge.message || "Failed to charge subscription");
    }

    return { subscription, payment: charge.data };
  }

  private computeNextBillingDate(record: any) {
    const now = new Date();
    switch (record.billingCycle) {
      case "monthly":
        now.setMonth(now.getMonth() + 1);
        break;
      case "quarterly":
        now.setMonth(now.getMonth() + 3);
        break;
      case "yearly":
        now.setFullYear(now.getFullYear() + 1);
        break;
      default:
        now.setDate(now.getDate() + 1);
    }
    return now;
  }
}

export const bankSubscriptionService = new BankSubscriptionService();
