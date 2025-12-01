import mongoose, { Schema, Document, Types } from "mongoose";
import { Gender } from "./user.model";

export enum InsuranceType {
  LIFE = "life",
  HEALTH = "health",
  VEHICLE = "vehicle",
  PROPERTY = "property",
  STOCK = "stock",
  MACHINERY = "machinery",
  TERM = "term",
  TRAVEL = "travel",
  RETIREMENT = "retirement",
  SHOP = "shop",
}

export enum InsuranceQueryActivityType {
  CREATED = "created",
  UPDATED = "updated",
  STATUS_CHANGED = "status_changed",
  LANDER_ASSIGNED = "lander_assigned",
  AGENT_ASSIGNED = "agent_assigned",
  DOCUMENT_UPLOADED = "document_uploaded",
  NOTE_ADDED = "note_added",
}

export interface IInsuranceQueryActivity {
  type: InsuranceQueryActivityType;
  description?: string;
  actor?: Types.ObjectId;
  actorModel?: "Admin" | "Agent" | "Lander" | "User";
  payload?: Record<string, any>;
  createdAt: Date;
}

export enum ApplicationStatus {
  DRAFT = "draft",
  PENDING = "pending",
  SUBMITTED = "submitted",
  UNDER_REVIEW = "under_review",
  APPROVED = "approved",
  REJECTED = "rejected",
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  EXPIRED = "expired",
  IN_PROGRESS = "in_progress",
  DOCUMENT_VERIFICATION = "document_verification",
  DISBURSED = "disbursed",
}

// Allowed fields mapping based on insurance type
export const allowedFieldsByFormType: Record<string, string[]> = {
  [InsuranceType.LIFE]: [
    "policyType",
    "sumAssured",
    "policyTerm",
    "loanType",
    "loanAmount",
    "loanTenure",
    "lendingBankName",
    "existingLifeInsurance",
    "medicalHistory",
    "nicotineProducts",
    "healthReports",
  ],
  [InsuranceType.HEALTH]: [
    "insuranceType",
    "numberOfMembersCovered",
    "name",
    "age",
    "relation",
    "healthConditionOfMember",
    "sumInsured",
    "existingMedicalConditions",
    "preExistingDiseases",
    "hospitalPreference",
    "claimHistory",
    "medicalReports",
    "members",
  ],
  [InsuranceType.VEHICLE]: [
    "vehicleType",
    "vehicleRegistrationNumber",
    "makeAndModel",
    "yearOfManufacture",
    "fuelType",
    "chassisNumberEngineNumber",
    "previousPolicyNumber",
    "policyExpiryDate",
    "claimHistory",
    "drivingLicenseUpload",
    "claimHistoryIfAny",
    "rcBookUpload",
    "preferredCoverage",
  ],
  [InsuranceType.PROPERTY]: [
    "propertyType",
    "ownershipType",
    "propertyAddress",
    "area",
    "constructionType",
    "yearBuild",
    "propertyValue",
    "coverageRequired",
    "propertyDocuments",
  ],
  [InsuranceType.STOCK]: [
    "businessType",
    "locationOfStock",
    "natureOfGoodsProducts",
    "averageMonthlyStockValue",
    "storageType",
    "securityMeasures",
    "fireSafetyInstalled",
    "coverageRequired",
    "stockValuationReport",
    "claimHistory",
    "rcBookUpload",
  ],
  [InsuranceType.MACHINERY]: [
    "machineryType",
    "make",
    "modelNo",
    "serialNumber",
    "yearOfPurchase",
    "currentMarketValue",
    "usageType",
    "operatingConditions",
    "maintenanceFrequency",
    "coverageRequired",
    "purchaseInvoice",
    "maintenanceRecord",
  ],
  [InsuranceType.TERM]: [
    "sumAssured",
    "policyTerm",
    "premiumPaymentFrequency",
    "existingPolicies",
    "medicalCheckupRequired",
    "medicalReportUpload",
  ],
  [InsuranceType.TRAVEL]: [
    "travelType",
    "lastName",
    "premiumPaymentFrequency",
    "existingPolicies",
    "medicalCheckupRequired",
    "medicalReportUpload",
  ],
  [InsuranceType.RETIREMENT]: [
    "desiredRetirementAge",
    "currentAge",
    "currentMonthlyIncome",
    "monthlyInvestmentCapacity",
    "preferredInvestmentType",
    "nomineeDetails",
    "existingPension",
    "panKycProof",
  ],
  [InsuranceType.SHOP]: [
    "shopName",
    "shopType",
    "shopAddress",
    "shopArea",
    "monthlyTurnover",
    "coverageType",
    "securitySafetyMeasures",
    "shopLicense",
    "gstCertificate",
  ],
};

export interface IInsuranceQuery extends Document {
  customerId: Types.ObjectId;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: Gender;
  mobile: string;
  isMobileVerified: boolean;
  email: string;
  isEmailVerified: boolean;
  fullAddress: string;
  pincode: string;
  city: string;
  state: string;
  nomineeName: string;
  nomineeRelation: string;
  occupation: string;
  annualIncome: number;
  kycDocumentType: string; // Pan/Aadhaar/Driving License
  kycDocumentUrl: string;
  typeOfInsurance: InsuranceType;
  status: ApplicationStatus;
  policyDetails?: Record<string, any>;
  assignedAgent?: Types.ObjectId;
  assignedLander?: Types.ObjectId;
  activities: IInsuranceQueryActivity[];
  createdAt: Date;
  updatedAt: Date;
}

const InsuranceQuerySchema = new Schema<IInsuranceQuery>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    gender: {
      type: String,
      enum: Object.values(Gender),
      required: true,
    },
    mobile: { type: String, required: true, trim: true, index: true },
    isMobileVerified: { type: Boolean, default: false },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    isEmailVerified: { type: Boolean, default: false },
    fullAddress: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    nomineeName: { type: String, required: true, trim: true },
    nomineeRelation: { type: String, required: true, trim: true },
    occupation: { type: String, required: true, trim: true },
    annualIncome: { type: Number, required: true },
    kycDocumentType: {
      type: String,
      enum: ["pan", "aadhaar", "driving_license"],
      required: true,
    },
    kycDocumentUrl: { type: String, required: true, trim: true },
    typeOfInsurance: {
      type: String,
      enum: Object.values(InsuranceType),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ApplicationStatus),
      required: true,
      default: ApplicationStatus.PENDING,
      index: true,
    },
    policyDetails: {
      type: Object,
      default: {},
    },
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: "Agent",
      index: true,
    },
    assignedLander: {
      type: Schema.Types.ObjectId,
      ref: "Lander",
      index: true,
    },
    activities: {
      type: [
        {
          type: {
            type: String,
            enum: Object.values(InsuranceQueryActivityType),
            required: true,
          },
          description: { type: String },
          actor: { type: Schema.Types.ObjectId },
          actorModel: {
            type: String,
            enum: ["Admin", "Agent", "Lander", "User"],
          },
          payload: { type: Schema.Types.Mixed },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

InsuranceQuerySchema.index({ mobile: 1, email: 1 });
InsuranceQuerySchema.index({ customerId: 1 });

export const InsuranceQuery = mongoose.model<IInsuranceQuery>(
  "InsuranceQuery",
  InsuranceQuerySchema
);

