import bcrypt from "bcryptjs";
import mongoose, { Schema, Document, Types } from "mongoose";
import {
  AddressSchema,
  BankDetailsSchema,
  DigiLockerVaultSchema,
  IDigiLockerVault,
  KycProfileSchema,
  LoginMethodSchema,
  LoginMethodType,
  SecurityPreferencesSchema,
  UserStatus,
  Gender,
} from "./user.model";

export type AgencyRole = "agency" | "agency_member";

export interface IAgency extends Document {
  name: string;
  email: string;
  mobile: string;
  role: AgencyRole;
  parentAgency?: Types.ObjectId;
  status: UserStatus;
  password?: string;
  refreshToken?: string;
  avatar?: string;
  profilePictureUrl?: string;
  agreedToTerms: boolean;
  privacyPolicyAccepted: boolean;
  isEmailVerified: boolean;
  isMobileVerified: boolean;
  gender?: Gender;
  notification?: {
    sms?: boolean;
    push?: boolean;
    email?: boolean;
    whatsapp?: boolean;
  };
  rmName?: string;
  rmMobile?: string;
  bankDetails?: typeof BankDetailsSchema;
  addresses?: Types.DocumentArray<typeof AddressSchema>;
  kycProfile?: typeof KycProfileSchema;
  digiLockerVault?: IDigiLockerVault;
  loginMethods?: typeof LoginMethodSchema;
  securityPreferences?: typeof SecurityPreferencesSchema;
  agentProfileCompleted?: boolean;
  cibilScore?: number;
  cibilLastFetchedAt?: Date;
  cibilReport?: Record<string, any>;
  cibilRequestPayload?: Record<string, any>;
  experianScore?: number;
  experianLastFetchedAt?: Date;
  experianReport?: Record<string, any>;
  cibilScoreCheckCredits?: number;
  experianScoreCheckCredits?: number;
  lastScorePurchaseAt?: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

type AgencyDocument = mongoose.HydratedDocument<IAgency>;

const AgencySchema = new Schema<IAgency>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      index: true,
      unique: true,
      required: true,
      lowercase: true,
    },
    mobile: { type: String, unique: true, required: true, index: true },
    role: {
      type: String,
      enum: ["agency", "agency_member"],
      default: "agency",
      required: true,
    },
    parentAgency: { type: Schema.Types.ObjectId, ref: "Agency" },
    status: {
      index: true,
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.PENDING_VERIFICATION,
    },
    password: { type: String },
    refreshToken: { type: String },
    avatar: { type: String },
    profilePictureUrl: { type: String },
    agreedToTerms: { type: Boolean, default: false },
    privacyPolicyAccepted: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    isMobileVerified: { type: Boolean, default: false },
    gender: {
      type: String,
      enum: Object.values(Gender),
      default: Gender.PREFER_NOT_TO_SAY,
    },
    notification: {
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: true },
    },
    rmName: { type: String, trim: true },
    rmMobile: { type: String, trim: true },
    agentProfileCompleted: { type: Boolean, default: false },
    bankDetails: { type: BankDetailsSchema },
    cibilScore: { type: Number },
    cibilLastFetchedAt: { type: Date },
    cibilReport: { type: Object },
    cibilRequestPayload: { type: Object },
    experianScore: { type: Number },
    experianLastFetchedAt: { type: Date },
    experianReport: { type: Object },
    cibilScoreCheckCredits: { type: Number, default: 0 },
    experianScoreCheckCredits: { type: Number, default: 0 },
    lastScorePurchaseAt: { type: Date },
    addresses: { type: [AddressSchema], default: [] },
    kycProfile: { type: KycProfileSchema, default: {} },
    digiLockerVault: {
      type: DigiLockerVaultSchema,
      default: {},
    },
    loginMethods: {
      type: [LoginMethodSchema],
      default: [
        { type: LoginMethodType.MOBILE_OTP, enabled: true, verified: false },
      ],
    },
    securityPreferences: {
      type: SecurityPreferencesSchema,
      default: {},
    },
  },
  { timestamps: true }
);

AgencySchema.pre("save", async function (this: AgencyDocument, next) {
  if (!this.isModified("password")) return next();
  if (!this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

AgencySchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password || "");
};

export const Agency = mongoose.model<IAgency>("Agency", AgencySchema);
