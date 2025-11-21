import ApiError from "../utils/ApiError";
import { ClientSession, Types } from "mongoose";
import AgentWallet from "../modals/agentWallet.model";
import WalletTransaction, {
  WalletTransactionType,
  WalletTransactionCategory,
} from "../modals/walletTransaction.model";

interface WalletTxInput {
  agentId: string | Types.ObjectId;
  amount: number;
  type: WalletTransactionType;
  category?: WalletTransactionCategory;
  description?: string;
  referenceId?: string;
  metadata?: Record<string, any>;
  session?: ClientSession;
  status?: "pending" | "completed" | "failed";
}

export class WalletService {
  static async getOrCreateWallet(
    agentId: string | Types.ObjectId,
    session?: ClientSession
  ) {
    const wallet = await AgentWallet.findOneAndUpdate(
      { agent: agentId },
      { $setOnInsert: { agent: agentId } },
      { upsert: true, new: true, session }
    );
    return wallet;
  }

  static async credit(input: WalletTxInput) {
    if (input.amount <= 0) {
      throw new ApiError(400, "Credit amount must be positive");
    }
    const wallet = await this.getOrCreateWallet(input.agentId, input.session);
    wallet.balance += input.amount;
    wallet.lifetimeEarnings += input.amount;
    wallet.lastTransactionAt = new Date();
    await wallet.save({ session: input.session });

    const transaction = await WalletTransaction.create(
      [
        {
          agent: wallet.agent,
          amount: input.amount,
          runningBalance: wallet.balance,
          type: input.type || "credit",
          category: input.category || "commission",
          referenceId: input.referenceId,
          description: input.description,
          metadata: input.metadata,
          status: input.status || "completed",
        },
      ],
      { session: input.session }
    );

    return { wallet, transaction: transaction[0] };
  }

  static async debit(input: WalletTxInput & { enforce?: boolean }) {
    if (input.amount <= 0) {
      throw new ApiError(400, "Debit amount must be positive");
    }
    const wallet = await this.getOrCreateWallet(input.agentId, input.session);

    if (wallet.balance < input.amount && input.enforce !== false) {
      throw new ApiError(400, "Insufficient wallet balance");
    }

    wallet.balance -= input.amount;
    wallet.lastTransactionAt = new Date();
    await wallet.save({ session: input.session });

    const transaction = await WalletTransaction.create(
      [
        {
          agent: wallet.agent,
          amount: input.amount,
          runningBalance: wallet.balance,
          type: input.type || "debit",
          category: input.category || "payout",
          referenceId: input.referenceId,
          description: input.description,
          metadata: input.metadata,
          status: input.status || "completed",
        },
      ],
      { session: input.session }
    );

    return { wallet, transaction: transaction[0] };
  }
}
