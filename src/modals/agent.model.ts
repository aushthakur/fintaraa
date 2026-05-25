import bcrypt from "bcrypt";
import mongoose, { Document, Schema, Model } from "mongoose";
import { LoanProductType } from "./user.model";
import { allocatePrefixedSequence } from "../utils/idAllocator";

export interface IAgent extends Document {
  agentId?: string;
  name: string;
  bio?: string;
  email: string;
  mobile?: string;
  password: string;
  refreshToken?: string;
  skills: string[];
  createdAt?: Date;
  updatedAt?: Date;
  location?: string;
  department?: string;
  availability: boolean;
  activeTickets: number;
  resolvedTickets: number;
  profilePictureUrl?: string;
  role: Schema.Types.ObjectId;
  leadCapacity?: number;
  activeLeads: number;
  serviceablePincodes?: string[];
  productFocus?: LoanProductType[];
  leadAutoAssign?: boolean;
  lastLeadAssignedAt?: Date;
}

const AgentSchema: Schema<IAgent> = new Schema(
  {
    agentId: { type: String, unique: true, sparse: true, index: true },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      ref: "Role",
      required: true,
      type: Schema.Types.ObjectId,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    mobile: {
      type: String,
      match: /^[6-9]\d{9}$/, // Indian format
    },
    password: { type: String, required: true },
    department: {
      type: String,
      trim: true,
    },
    profilePictureUrl: {
      type: String,
    },
    bio: {
      type: String,
      maxlength: 1000,
    },
    location: {
      type: String,
      trim: true,
    },
    availability: {
      type: Boolean,
      default: true,
    },
    activeTickets: {
      type: Number,
      default: 0,
    },
    resolvedTickets: {
      type: Number,
      default: 0,
    },
    leadCapacity: {
      type: Number,
      default: 40,
      min: 5,
    },
    activeLeads: {
      type: Number,
      default: 0,
      min: 0,
    },
    leadAutoAssign: {
      type: Boolean,
      default: true,
    },
    lastLeadAssignedAt: {
      type: Date,
    },
    serviceablePincodes: [
      {
        type: String,
        trim: true,
      },
    ],
    productFocus: [
      {
        type: String,
        enum: Object.values(LoanProductType),
      },
    ],
    skills: [
      {
        type: String,
        trim: true,
      },
    ],
    refreshToken: {
      type: String,
    },
  },
  { timestamps: true }
);

// 🔐 Method to compare password during login
AgentSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// 🔒 Pre-save hook to hash password if modified
AgentSchema.pre<IAgent>("save", async function (next) {
  try {
    if (this.isNew && !this.agentId) {
      this.agentId = await allocatePrefixedSequence({
        key: "agentId",
        prefix: "FIN",
        padLength: 4,
        session: this.$session() || undefined,
      });
    }

    if (this.isModified("password")) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    return next();
  } catch (err) {
    return next(err as Error);
  }
});

// 🔄 Pre-update hook for findOneAndUpdate / updateOne
async function hashPasswordInUpdate(this: any, next: any) {
  const update = this.getUpdate();
  if (!update) return next();

  const password = update.password || update.$set?.password;
  if (!password) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    if (update.password) update.password = hashed;
    if (update.$set?.password) update.$set.password = hashed;

    next();
  } catch (err) {
    next(err);
  }
}

AgentSchema.pre("findOneAndUpdate", hashPasswordInUpdate);
AgentSchema.pre("updateOne", hashPasswordInUpdate);

const Agent: Model<IAgent> = mongoose.model<IAgent>("Agent", AgentSchema);

export default Agent;
