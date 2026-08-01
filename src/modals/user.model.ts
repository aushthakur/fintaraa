import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config/config";
import {
  allocatePrefixedSequence,
  formatYearMonthDaySequencePrefix,
} from "../utils/idAllocator";
import {
  buildUserReferralCode,
  normalizeReferralCode,
} from "../utils/referral";
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
  { _id: false },
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

export enum AccountSource {
  WEBSITE = "website",
  APP = "app",
  ADMIN = "admin",
  CRM = "crm",
  UNKNOWN = "unknown",
}

export enum RegistrationSource {
  ORGANIC = "organic",
  REFERRAL = "referral",
  PAID = "paid",
  WHATSAPP = "whatsapp",
  APP = "app",
  WEBSITE = "website",
  ADMIN = "admin",
  CRM = "crm",
  UNKNOWN = "unknown",
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
  TOP_UP_LOAN = "top_up_loan",
  BALANCE_TRANSFER_TOP_UP_LOAN = "Balance Transfer+ Top Up Loan",
  HOME_LOAN = "home_loan",
  BUSINESS_LOAN = "business_loan",
  AGRICULTURE_LOAN = "Agriculture Loan",
  SOLAR_LOAN = "Solar Loan",
  CAR_LOAN = "Vechile Loan",
  TWO_WHEELER_LOAN = "Two Wheeler Loan",
  VEHICLE_LOAN = "vehicle_loan",
  INSTANT_LOAN = "instant_loan",
  EDUCATION_LOAN = "education_loan",
  GOLD_LOAN = "gold_loan",
  LOAN_AGAINST_PROPERTY = "loan_against_property",
  RENOVATION_LOAN = "renovation_loan",
  WORKING_CAPITAL_LOAN = "working_capital_loan",
  LOAN_AGAINST_SECURITY = "loan_against_security",
  LOAN_AGAINST_CAR = "loan_against_car",
  MACHINERY_LOAN = "machinery_loan",
  DOD_LOAN = "dod_loan",
  OD_LOAN = "od_loan",
  INDUSTRIAL_LOAN = "industrial_loan",
  COMMERCIAL_PURCHASES_LOAN = "commercial_purchases_loan",
  CREDIT_CARD = "credit_card",
  BNPL = "bnpl",
}

export const BankDetailsSchema = new Schema(
  {
    ifscCode: String,
    bankName: String,
    branchName: String,
    branchCity: String,
    accountType: String,
    accountNumber: String,
    accountHolderName: String,
    cancelledChequeUrl: { type: String, trim: true },
    verified: { type: Boolean, default: false },
    verificationStatus: { type: String, trim: true },
    verificationMessage: { type: String, trim: true },
    verificationReferenceId: { type: String, trim: true },
    verificationUtr: { type: String, trim: true },
    verifiedAt: { type: Date },
  },
  { _id: false },
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
  { _id: false },
);

const EmergencyContactSchema = new Schema(
  {
    name: { type: String },
    email: { type: String },
    phoneNumber: { type: String },
    relationship: { type: String },
    address: { type: AddressSchema },
  },
  { _id: false },
);

export interface IDocumentRecord {
  docType: string;
  number?: string;
  password?: string;
  issuer?: string;
  fileUrl?: string;
  issuedOn?: Date;
  uploadedAt?: Date;
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
    uploadedAt: { type: Date, default: Date.now },
    verified: { type: Boolean, default: false },
    referenceId: { type: String, trim: true },
  },
  { _id: false },
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
  { _id: false },
);

export interface IDeviceAuth {
  deviceId: string;
  deviceName?: string;
  platform?: string;
  lastLoginAt?: Date;
  biometricEnabled?: boolean;
  pushToken?: string;
}

export interface IPushToken {
  token: string;
  platform?: "ios" | "android" | "web" | "unknown";
  deviceId?: string;
  appVersion?: string;
  active: boolean;
  lastRegisteredAt?: Date;
  lastUsedAt?: Date;
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
  { _id: false },
);

export const PushTokenSchema = new Schema(
  {
    token: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },
    deviceId: { type: String, trim: true },
    appVersion: { type: String, trim: true },
    active: { type: Boolean, default: true },
    lastRegisteredAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
  },
  { _id: false },
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
  { _id: false },
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
  { _id: false },
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
  { _id: false },
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
      registerAs: { type: String, trim: true },
      fullName: { type: String, trim: true },
      fatherName: { type: String, trim: true },
      motherName: { type: String, trim: true },
      dateOfBirth: { type: Date },
      gender: { type: String },
      aadhaarNumber: { type: String, trim: true },
      panNumber: { type: String, trim: true },
      maritalStatus: { type: String, trim: true },
      dependents: { type: Number },
      mobile: { type: String, trim: true },
      email: { type: String, trim: true },
      address: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pinCode: { type: String, trim: true },
      pincode: { type: String, trim: true },
      companyName: { type: String, trim: true },
      businessName: { type: String, trim: true },
      shopName: { type: String, trim: true },
      authorisedPersonName: { type: String, trim: true },
      authorisedPersonMobile: { type: String, trim: true },
      authorisedPersonEmail: { type: String, trim: true },
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
  { _id: false },
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
  { _id: false },
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
  { _id: false },
);

export interface IUser extends Document {
  name: string;
  role: string;
  email?: string;
  mobile: string;
  gender?: Gender;
  avatar?: string;
  referralCode?: string;
  referralPoints?: number;
  referralRewardCredits?: Types.ObjectId[];
  referredBy?: Types.ObjectId;
  accountSource?: AccountSource;
  registrationSource?: RegistrationSource;
  acquisition?: Record<string, any>;
  isDeleted?: boolean;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  password: string;
  fcmToken?: string;
  fcmTokens?: IPushToken[];
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
  cibilPdfLastFetchedAt?: Date;
  cibilPdfReport?: Record<string, any>;
  experianScore?: number;
  experianLastFetchedAt?: Date;
  experianReport?: Record<string, any>;
  cibilScoreCheckCredits?: number;
  experianScoreCheckCredits?: number;
  lastScorePurchaseAt?: Date;
  contactsSyncEnabled?: boolean;
}

const UserSchema = new Schema<IUser>(
  {
    avatar: { type: String },
    accountSource: {
      type: String,
      enum: Object.values(AccountSource),
      default: AccountSource.UNKNOWN,
      index: true,
    },
    registrationSource: {
      type: String,
      enum: Object.values(RegistrationSource),
      default: RegistrationSource.UNKNOWN,
      index: true,
    },
    acquisition: { type: Schema.Types.Mixed },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      set: normalizeReferralCode,
    },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    referralPoints: { type: Number, default: 0 },
    referralRewardCredits: {
      type: [{ type: Schema.Types.ObjectId, ref: "ReferralEvent" }],
      default: [],
      select: false,
    },
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
    fcmTokens: { type: [PushTokenSchema], default: [] },
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
      sparse: true,
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

    cancelledChequeOrPassbook: { type: String, default: null },
    panCard: { type: String, unique: true, sparse: true, trim: true },
    panCardUrl: { type: String, unique: true, sparse: true, trim: true },
    aadhaarCard: { type: String, unique: true, sparse: true, trim: true },
    aadhaarCardUrl: { type: String, unique: true, sparse: true, trim: true },
    cibilScore: { type: Number },
    cibilLastFetchedAt: { type: Date },
    cibilReport: { type: Object },
    cibilRequestPayload: { type: Object },
    cibilPdfLastFetchedAt: { type: Date },
    cibilPdfReport: { type: Object },
    experianScore: { type: Number },
    experianLastFetchedAt: { type: Date },
    experianReport: { type: Object },
    cibilScoreCheckCredits: { type: Number, default: 0 },
    experianScoreCheckCredits: { type: Number, default: 0 },
    lastScorePurchaseAt: { type: Date },
    contactsSyncEnabled: { type: Boolean, default: true },
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
  { timestamps: true },
);

UserSchema.index({ email: 1, status: 1 });
UserSchema.index({ accountSource: 1, createdAt: -1 });
UserSchema.index({ registrationSource: 1, createdAt: -1 });
UserSchema.index({ isDeleted: 1, createdAt: -1 });
UserSchema.index({ "fcmTokens.token": 1 });

export const generateReferralCode = (userId: string) =>
  buildUserReferralCode(userId);

const allocateUniqueCustomerId = async (user: any): Promise<string> => {
  const session = user.$session();
  const UserModel = user.constructor as any;
  const maxAttempts = 25;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const datePrefix = formatYearMonthDaySequencePrefix(new Date());
    const candidate = await allocatePrefixedSequence({
      key: `customerId:${datePrefix}`,
      prefix: `FIN${datePrefix}`,
      padLength: 4,
      session: session || undefined,
    });
    let collisionQuery = UserModel.exists({
      customerId: candidate,
      _id: { $ne: user._id },
    });
    if (session) {
      collisionQuery = collisionQuery.session(session);
    }
    const collision = await collisionQuery;

    if (!collision) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate a unique customer ID");
};

// Every user receives a scalable referral code. Existing codes are preserved.
// This also backfills a missing code whenever a legacy/placeholder user is
// next saved (for example, after successful OTP verification).
UserSchema.pre("validate", function (next) {
  if (this.role === "user" && !this.referralCode) {
    this.referralCode = buildUserReferralCode(this._id);
  }
  next();
});

// 🔐 Password Hash Middleware
UserSchema.pre("save", async function (next) {
  const user = this as IUser;
  if (user.isNew && user.role === "user" && !user.customerId) {
    user.customerId = await allocateUniqueCustomerId(user);
  }
  if (!user.isModified("password")) return next();
  if (!user.password) return next();

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
  next();
});

// ✅ Compare Password
UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
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
