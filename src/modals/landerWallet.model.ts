import mongoose, { Document, Schema } from "mongoose";

export interface ILanderWallet extends Document {
  lander: Schema.Types.ObjectId;
  balance: number;
  pendingPayout: number;
  lockedBalance: number;
  lifetimeEarnings: number;
  lastTransactionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LanderWalletSchema = new Schema<ILanderWallet>(
  {
    lander: { type: Schema.Types.ObjectId, ref: "Lander", unique: true },
    balance: { type: Number, default: 0 },
    pendingPayout: { type: Number, default: 0 },
    lockedBalance: { type: Number, default: 0 },
    lifetimeEarnings: { type: Number, default: 0 },
    lastTransactionAt: { type: Date },
  },
  { timestamps: true }
);

const LanderWallet = mongoose.model<ILanderWallet>(
  "LanderWallet",
  LanderWalletSchema
);

export default LanderWallet;

