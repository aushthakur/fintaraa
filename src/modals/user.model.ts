import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config/config";
import mongoose, { Schema, Document, Types } from "mongoose";

export enum UserStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  SUSPENDED = "suspended",
  DEACTIVATED = "deactivated",
  PENDING_VERIFICATION = "pending_verification",
}

export enum Gender {
  MALE = "male",
  OTHER = "other",
  FEMALE = "female",
  PREFER_NOT_TO_SAY = "prefer_not_to_say",
}

const CoordinatesSchema = new Schema(
  {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  { _id: false }
);

export enum PropertyOwnerType {
  TRUST = "trust",
  COMPANY = "company",
  INDIVIDUAL = "individual",
  PARTNERSHIP = "partnership",
}

const BankDetailsSchema = new Schema(
  {
    ifscCode: String,
    bankName: String,
    branchName: String,
    accountNumber: String,
    accountHolderName: String,
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

const AddressSchema = new Schema(
  {
    city: { type: String },
    state: { type: String },
    street: { type: String },
    country: { type: String },
    postalCode: { type: String },
    isDefault: { type: Boolean, default: false },
    coordinates: { type: CoordinatesSchema, required: false },
    label: { type: String, enum: ["home", "office"], required: false },
  },
  { _id: false }
);

const EmergencyContactSchema = new Schema(
  {
    name: { type: String },
    email: { type: String },
    phoneNumber: { type: String },
    relationship: { type: String },
    address: { type: AddressSchema },
  },
  { _id: false }
);

export interface IUser extends Document {
  name: string;
  role: string;
  email: string;
  mobile: string;
  gender?: Gender;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
  password: string;
  fcmToken?: string;
  status: UserStatus;
  dateOfBirth?: Date;
  lastLoginAt?: Date;
  lastActiveAt?: Date;
  refreshToken?: string;
  agreedToTerms: boolean;
  isEmailVerified: boolean;
  isMobileVerified: boolean;
  privacyPolicyAccepted: boolean;
  notification: {
    sms: boolean;
    push: boolean;
    email: boolean;
  };
  profile: {};
  generateJWT(): string;
  ownerType?: PropertyOwnerType;
  bankDetails?: typeof BankDetailsSchema;
  emergencyContact?: typeof EmergencyContactSchema;
  addresses: Types.DocumentArray<typeof AddressSchema>;
  comparePassword(candidatePassword: string): Promise<boolean>;

  // ✅ New KYC fields
  panCard?: string;
  panCardUrl?: string;
  aadhaarCard?: string;
  aadhaarCardUrl?: string;
  cancelledChequeOrPassbook?: string;
}

const UserSchema = new Schema<IUser>(
  {
    avatar: { type: String },
    password: { type: String },
    lastLoginAt: { type: Date },
    lastActiveAt: { type: Date },
    refreshToken: { type: String },
    name: { type: String, required: true },
    role: { type: String, required: true },
    bankDetails: { type: BankDetailsSchema },
    addresses: { type: [AddressSchema], default: [] },
    isEmailVerified: { type: Boolean, default: false },
    emergencyContact: { type: EmergencyContactSchema },
    isMobileVerified: { type: Boolean, default: false },
    fcmToken: { type: String, unique: true, sparse: true },
    mobile: { type: String, unique: true, required: true, index: true },
    notification: {
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
    },
    profile: {},
    agreedToTerms: { type: Boolean, required: true, default: false },
    ownerType: { type: String, enum: Object.values(PropertyOwnerType) },
    privacyPolicyAccepted: { type: Boolean, required: true, default: false },
    email: {
      type: String,
      index: true,
      unique: true,
      required: true,
      lowercase: true,
    },
    gender: {
      type: String,
      enum: Object.values(Gender),
      default: Gender.PREFER_NOT_TO_SAY,
    },
    status: {
      index: true,
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.PENDING_VERIFICATION,
    },

    panCard: { type: String, unique: true, sparse: true, trim: true },
    panCardUrl: { type: String, unique: true, sparse: true, trim: true },
    aadhaarCard: { type: String, unique: true, sparse: true, trim: true },
    aadhaarCardUrl: { type: String, unique: true, sparse: true, trim: true },
    cancelledChequeOrPassbook: { type: String, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1, status: 1 });

export const generateReferralCode = (userId: string) => {
  const prefix = "REF";
  const randomPart = crypto.randomBytes(2).toString("hex");
  const userPart = userId.toString().slice(-4);
  return `${prefix}-${randomPart}-${userPart}`.toUpperCase();
};

// 🔐 Password Hash Middleware
UserSchema.pre("save", async function (next) {
  const user = this as IUser;
  if (!user.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
  next();
});

// ✅ Compare Password
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 🪪 Generate JWT
UserSchema.methods.generateJWT = function (): string {
  return jwt.sign({ id: this._id, email: this.email }, config.jwt.secret, {
    expiresIn: "7d",
  });
};

export const User = mongoose.model<IUser>("User", UserSchema);
