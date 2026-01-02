import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config/config";
import { Counter } from "./counter.model";
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

export enum LoginMethodType {
  MOBILE_OTP = "mobile_otp",
  EMAIL_PASSWORD = "email_password",
  GOOGLE = "google",
  APPLE = "apple",
}

export enum EmploymentType {
  SALARIED = "salaried",
  SELF_EMPLOYED = "self_employed",
  BUSINESS_OWNER = "business_owner",
  STUDENT = "student",
  RETIRED = "retired",
  SELF_EMPLOYED_PROFESSIONAL = "selfEmployedProfessional",
  SELF_EMPLOYED_NON_PROFESSIONAL = "selfEmployedNonProfessional",
}

export enum KycVerificationStatus {
  NOT_STARTED = "not_started",
  IN_PROGRESS = "in_progress",
  VERIFIED = "verified",
  REJECTED = "rejected",
}

export enum LoanProductType {
  PERSONAL_LOAN = "personal_loan",
  HOME_LOAN = "home_loan",
  BUSINESS_LOAN = "business_loan",
  CREDIT_CARD = "credit_card",
  BNPL = "bnpl",
}

export const BankDetailsSchema = new Schema(
  {
    ifscCode: String,
    bankName: String,
    branchName: String,
    accountType: String,
    accountNumber: String,
    accountHolderName: String,
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

export const AddressSchema = new Schema(
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

export interface IDocumentRecord {
  docType: string;
  number?: string;
  password?: string;
  issuer?: string;
  fileUrl?: string;
  issuedOn?: Date;
  verified?: boolean;
  referenceId?: string;
}

export const DocumentSchema = new Schema(
  {
    docType: { type: String, required: true, trim: true },
    number: { type: String, trim: true },
    password: { type: String, trim: true },
    issuer: { type: String, trim: true },
    fileUrl: { type: String, trim: true },
    issuedOn: { type: Date },
    verified: { type: Boolean, default: false },
    referenceId: { type: String, trim: true },
  },
  { _id: false }
);

export interface ILoginMethod {
  type: LoginMethodType;
  enabled: boolean;
  verified: boolean;
  lastUsedAt?: Date;
  deviceLimit?: number;
}

export const LoginMethodSchema = new Schema(
  {
    type: {
      type: String,
      enum: Object.values(LoginMethodType),
      required: true,
    },
    enabled: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    lastUsedAt: { type: Date },
    deviceLimit: { type: Number, default: 3 },
  },
  { _id: false }
);

export interface IDeviceAuth {
  deviceId: string;
  deviceName?: string;
  platform?: string;
  lastLoginAt?: Date;
  biometricEnabled?: boolean;
  pushToken?: string;
}

const DeviceAuthSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    deviceName: { type: String },
    platform: { type: String, enum: ["ios", "android", "web"], default: "web" },
    lastLoginAt: { type: Date },
    biometricEnabled: { type: Boolean, default: false },
    pushToken: { type: String },
  },
  { _id: false }
);

export interface ISecurityPreferences {
  mfaEnabled: boolean;
  preferredMfaMethods: string[];
  biometricEnabled: boolean;
  deviceLevelAuth: boolean;
  trustedDevices: IDeviceAuth[];
  lastMfaChallengeAt?: Date;
}

export const SecurityPreferencesSchema = new Schema(
  {
    mfaEnabled: { type: Boolean, default: false },
    preferredMfaMethods: [
      {
        type: String,
        enum: ["otp", "email", "auth_app"],
      },
    ],
    biometricEnabled: { type: Boolean, default: false },
    deviceLevelAuth: { type: Boolean, default: false },
    trustedDevices: { type: [DeviceAuthSchema], default: [] },
    lastMfaChallengeAt: { type: Date },
  },
  { _id: false }
);

export interface IEmploymentDetails {
  employmentType?: EmploymentType;
  employerName?: string;
  employerType?: string;
  industry?: string;
  monthlyIncome?: number;
  annualIncome?: number;
  annualTurnover?: number;
  businessIncome?: number;
  workEmail?: string;
  workPhone?: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  officeCity?: string;
  officeState?: string;
  officePinCode?: string;
  salaryAccountBank?: string;
  employmentStatus?: string;
  businessRegistrationType?: string;
  gstNumber?: string;
  numberOfEmployees?: number;
  licenseNumber?: string;
  website?: string;
  taxId?: string;
  startDate?: Date;
  organizationId?: string;
  tenure?: string;
  companyType?: string;
  gstTurnover?: string;
  businessType?: string;
  companyAddress?: string;
  totalExperience?: string;
  businessVintage?: string;
  professionOrJobTitle?: string;
  experienceInCurrentCompany?: string;
  propertyType?: string;
  emiPaid?: string;
}

const EmploymentDetailsSchema = new Schema(
  {
    employmentType: {
      type: String,
      enum: Object.values(EmploymentType),
    },
    startDate: { type: Date },
  monthlyIncome: { type: Number },
  annualIncome: { type: Number },
  annualTurnover: { type: Number },
  businessIncome: { type: Number },
  taxId: { type: String, trim: true },
  tenure: { type: String, trim: true },
  industry: { type: String, trim: true },
  workEmail: { type: String, trim: true },
  workPhone: { type: String, trim: true },
  businessEmail: { type: String, trim: true },
  businessPhone: { type: String, trim: true },
  businessAddress: { type: String, trim: true },
  officeCity: { type: String, trim: true },
  officeState: { type: String, trim: true },
  officePinCode: { type: String, trim: true },
  salaryAccountBank: { type: String, trim: true },
  employmentStatus: { type: String, trim: true },
  businessRegistrationType: { type: String, trim: true },
  gstNumber: { type: String, trim: true },
  numberOfEmployees: { type: Number },
  licenseNumber: { type: String, trim: true },
  website: { type: String, trim: true },
  companyType: { type: String, trim: true },
  gstTurnover: { type: String, trim: true },
  employerName: { type: String, trim: true },
    employerType: { type: String, trim: true },
    businessType: { type: String, trim: true },
    organizationId: { type: String, trim: true },
    companyAddress: { type: String, trim: true },
    totalExperience: { type: String, trim: true },
    businessVintage: { type: String, trim: true },
    professionOrJobTitle: { type: String, trim: true },
    experienceInCurrentCompany: { type: String, trim: true },
    propertyType: { type: String, trim: true },
    emiPaid: { type: String, trim: true },
  },
  { _id: false }
);

export interface IFinancialDetails {
  monthlyIncome?: number;
  annualIncome?: number;
  creditScore?: number;
  existingEmiObligations?: number;
  averageBankBalance?: number;
  preferredProducts?: Array<{
    productType: LoanProductType;
    desiredLimit?: number;
    preferredLimit?: number;
    tenurePreferenceMonths?: number;
    priority?: number;
  }>;
}

const FinancialDetailsSchema = new Schema(
  {
    monthlyIncome: { type: Number },
    annualIncome: { type: Number },
    creditScore: { type: Number },
    existingEmiObligations: { type: Number },
    averageBankBalance: { type: Number },
    preferredProducts: [
      {
        productType: {
          type: String,
          enum: Object.values(LoanProductType),
        },
        desiredLimit: { type: Number },
        preferredLimit: { type: Number },
        tenurePreferenceMonths: { type: Number },
        priority: { type: Number, default: 1 },
      },
    ],
  },
  { _id: false }
);

export interface IKycProfile {
  reusableAcrossApplications: boolean;
  personalDetails?: {
    fullName?: string;
    fatherName?: string;
    motherName?: string;
    dateOfBirth?: Date;
    gender?: string;
    aadhaarNumber?: string;
    panNumber?: string;
    maritalStatus?: string;
    dependents?: number;
  };
  addressDetails?: {
    currentAddress?: Record<string, unknown>;
    permanentAddress?: Record<string, unknown>;
    proofOfAddress?: IDocumentRecord;
  };
  employmentDetails?: IEmploymentDetails;
  financialDetails?: IFinancialDetails;
  documents?: IDocumentRecord[];
  verification?: {
    status: KycVerificationStatus;
    verifiedAt?: Date;
    verifiedBy?: string;
    notes?: string;
  };
}

export const KycProfileSchema = new Schema(
  {
    reusableAcrossApplications: { type: Boolean, default: true },
    personalDetails: {
      fullName: { type: String, trim: true },
      fatherName: { type: String, trim: true },
      motherName: { type: String, trim: true },
      dateOfBirth: { type: Date },
      gender: { type: String },
      aadhaarNumber: { type: String, trim: true },
      panNumber: { type: String, trim: true },
      maritalStatus: { type: String, trim: true },
      dependents: { type: Number },
    },
    addressDetails: {
      currentAddress: { type: AddressSchema },
      permanentAddress: { type: AddressSchema },
      proofOfAddress: { type: DocumentSchema },
    },
    employmentDetails: { type: EmploymentDetailsSchema },
    financialDetails: { type: FinancialDetailsSchema },
    documents: { type: [DocumentSchema], default: [] },
    verification: {
      status: {
        type: String,
        enum: Object.values(KycVerificationStatus),
        default: KycVerificationStatus.NOT_STARTED,
      },
      verifiedAt: { type: Date },
      verifiedBy: { type: String },
      notes: { type: String },
    },
  },
  { _id: false }
);

export interface IDigiLockerVault {
  syncedAt?: Date;
  storageProvider?: string;
  documents: Array<
    IDocumentRecord & {
      parsedData?: Record<string, unknown>;
    }
  >;
}

export const DigiLockerVaultSchema = new Schema(
  {
    syncedAt: { type: Date },
    storageProvider: { type: String, default: "internal" },
    documents: {
      type: [
        {
          ...DocumentSchema.obj,
          parsedData: { type: Object },
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

export interface ILoanCreditProfile {
  preferredProducts: Array<{
    productType: LoanProductType;
    preferredLimit?: number;
    tenurePreferenceMonths?: number;
  }>;
  lastEligibilityCheck?: Date;
  eligibilityScore?: number;
  existingObligations?: Array<{
    lender?: string;
    type?: string;
    outstandingAmount?: number;
    emi?: number;
    active?: boolean;
  }>;
  reusableProfileReferenceId?: string;
}

const LoanCreditProfileSchema = new Schema(
  {
    preferredProducts: {
      type: [
        {
          productType: {
            type: String,
            enum: Object.values(LoanProductType),
          },
          preferredLimit: { type: Number },
          tenurePreferenceMonths: { type: Number },
        },
      ],
      default: [],
    },
    lastEligibilityCheck: { type: Date },
    eligibilityScore: { type: Number },
    existingObligations: [
      {
        lender: { type: String },
        type: { type: String },
        outstandingAmount: { type: Number },
        emi: { type: Number },
        active: { type: Boolean, default: true },
      },
    ],
    reusableProfileReferenceId: { type: String },
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
  referralCode?: string;
  referralPoints?: number;
  referredBy?: Types.ObjectId;
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
    whatsapp: boolean;
  };
  profile: {};
  customerId?: string;
  generateJWT(): string;
  ownerType?: PropertyOwnerType;
  bankDetails?: typeof BankDetailsSchema;
  emergencyContact?: typeof EmergencyContactSchema;
  addresses: Types.DocumentArray<typeof AddressSchema>;
  comparePassword(candidatePassword: string): Promise<boolean>;
  loginMethods?: ILoginMethod[];
  securityPreferences?: ISecurityPreferences;
  kycProfile?: IKycProfile;
  digiLockerVault?: IDigiLockerVault;
  loanCreditProfile?: ILoanCreditProfile;

  // ✅ New KYC fields
  panCard?: string;
  panCardUrl?: string;
  aadhaarCard?: string;
  aadhaarCardUrl?: string;
  cancelledChequeOrPassbook?: string;
  cibilScore?: number;
  cibilLastFetchedAt?: Date;
  cibilReport?: Record<string, any>;
  cibilRequestPayload?: Record<string, any>;
}

const UserSchema = new Schema<IUser>(
  {
    avatar: { type: String },
    referralCode: { type: String, unique: true, sparse: true, trim: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    referralPoints: { type: Number, default: 0 },
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
      whatsapp: { type: Boolean, default: true },
    },
    customerId: { type: String, unique: true, sparse: true, index: true },
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
    cibilScore: { type: Number },
    cibilLastFetchedAt: { type: Date },
    cibilReport: { type: Object },
    cibilRequestPayload: { type: Object },
    loginMethods: {
      type: [LoginMethodSchema],
      default: [
        { type: LoginMethodType.MOBILE_OTP, enabled: true, verified: false },
        {
          type: LoginMethodType.EMAIL_PASSWORD,
          enabled: true,
          verified: false,
        },
      ],
    },
    securityPreferences: {
      type: SecurityPreferencesSchema,
      default: {},
    },
    kycProfile: {
      type: KycProfileSchema,
      default: {},
    },
    digiLockerVault: {
      type: DigiLockerVaultSchema,
      default: {},
    },
    loanCreditProfile: {
      type: LoanCreditProfileSchema,
      default: {},
    },
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
  if (user.isNew && user.role === "user" && !user.customerId) {
    const session = user.$session();
    const counter = await Counter.findOneAndUpdate(
      { key: "customerId" },
      { $inc: { seq: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        ...(session ? { session } : {}),
      }
    );
    user.customerId = `FINT${counter.seq}`;
  }
  if (!user.isModified("password")) return next();
  if (!user.password) return next();

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
