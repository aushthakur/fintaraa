import mongoose, { Document, Schema } from "mongoose";

export interface IAgentWallet extends Document {
  agent: Schema.Types.ObjectId;
  balance: number;
  pendingPayout: number;
  lockedBalance: number;
  lifetimeEarnings: number;
  lastTransactionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentWalletSchema = new Schema<IAgentWallet>(
  {
    agent: { type: Schema.Types.ObjectId, ref: "Agent", unique: true },
    balance: { type: Number, default: 0 },
    pendingPayout: { type: Number, default: 0 },
    lockedBalance: { type: Number, default: 0 },
    lifetimeEarnings: { type: Number, default: 0 },
    lastTransactionAt: { type: Date },
  },
  { timestamps: true }
);

const AgentWallet = mongoose.model<IAgentWallet>(
  "AgentWallet",
  AgentWalletSchema
);

export default AgentWallet;
