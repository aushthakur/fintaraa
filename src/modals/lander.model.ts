import bcrypt from "bcrypt";
import mongoose, { Document, Schema, Model } from "mongoose";

export interface ILander extends Document {
  name: string;
  email: string;
  mobile: string;
  password: string;
  refreshToken?: string;
  role: Schema.Types.ObjectId;
  location?: string;
  availability: boolean;
  leadCapacity?: number;
  activeLeads: number;
  completedLeads: number;
  profilePictureUrl?: string;
  serviceablePincodes?: string[];
  lastLeadAssignedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const LanderSchema: Schema<ILander> = new Schema(
  {
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
      lowercase: true,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
      match: /^[6-9]\d{9}$/, // Indian mobile format
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    location: {
      type: String,
      trim: true,
    },
    availability: {
      type: Boolean,
      default: true,
    },
    leadCapacity: {
      type: Number,
      default: 50,
      min: 5,
    },
    activeLeads: {
      type: Number,
      default: 0,
      min: 0,
    },
    completedLeads: {
      type: Number,
      default: 0,
      min: 0,
    },
    profilePictureUrl: {
      type: String,
    },
    serviceablePincodes: [
      {
        type: String,
        trim: true,
      },
    ],
    lastLeadAssignedAt: {
      type: Date,
    },
    refreshToken: {
      type: String,
    },
  },
  { timestamps: true }
);

// 🔐 Method to compare password during login
LanderSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// 🔒 Pre-save hook to hash password if modified
LanderSchema.pre<ILander>("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
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

LanderSchema.pre("findOneAndUpdate", hashPasswordInUpdate);
LanderSchema.pre("updateOne", hashPasswordInUpdate);

// Indexes
LanderSchema.index({ email: 1 });
LanderSchema.index({ mobile: 1 });
LanderSchema.index({ availability: 1 });
LanderSchema.index({ location: 1 });

const Lander: Model<ILander> = mongoose.model<ILander>("Lander", LanderSchema);

export default Lander;
