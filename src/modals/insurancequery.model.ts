import mongoose, { Schema, Document, Types } from "mongoose";
import { Gender } from "./user.model";

export enum InsuranceType {
  LIFE = "life",
  SHOP = "shop",
  TERM = "term",
  STOCK = "stock",
  TRAVEL = "travel",
  HEALTH = "health",
  VEHICLE = "vehicle",
  PROPERTY = "property",
  MACHINERY = "machinery",
  RETIREMENT = "retirement",
}

export enum InsuranceQueryActivityType {
  CREATED = "created",
  UPDATED = "updated",
  NOTE_ADDED = "note_added",
  STATUS_CHANGED = "status_changed",
  FOLLOW_UP_UPDATED = "follow_up_updated",
  AGENT_ASSIGNED = "agent_assigned",
  LANDER_ASSIGNED = "lander_assigned",
  DOCUMENT_UPLOADED = "document_uploaded",
}

export interface IInsuranceQueryActivity {
  type: InsuranceQueryActivityType;
  description?: string;
  actor?: Types.ObjectId;
  actorModel?: "Admin" | "Agent" | "Lander" | "User";
  payload?: Record<string, any>;
  createdAt: Date;
}

export enum InsuranceFollowUpType {
  CALL = "call",
  WHATSAPP = "whatsapp",
  EMAIL = "email",
  DOCUMENT = "document",
  INSURER_UPDATE = "insurer_update",
  OTHER = "other",
}

export enum InsuranceFollowUpStatus {
  PENDING = "pending",
  DONE = "done",
  MISSED = "missed",
  CANCELLED = "cancelled",
}

export enum InsuranceFollowUpPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export interface IInsuranceQueryFollowUp {
  dueAt?: Date;
  type?: InsuranceFollowUpType;
  reason?: string;
  assignedTo?: Types.ObjectId;
  status?: InsuranceFollowUpStatus;
  priority?: InsuranceFollowUpPriority;
  outcome?: string;
  remark?: string;
  updatedBy?: Types.ObjectId;
  updatedByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IInsuranceQueryFollowUpHistory
  extends IInsuranceQueryFollowUp {
  action?: "scheduled" | "completed" | "missed" | "cancelled" | "updated";
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
  CONNECTED = "connected",
  NOT_INTERESTED = "not_interested",
  INTERESTED = "interested",
  QUALIFIED = "qualified",
  ALREADY_APPLIED_ELSEWHERE = "already_applied_elsewhere",
  FOLLOW_UP_SCHEDULED = "follow_up_scheduled",
  FOLLOW_UP_REQUIRED = "follow_up_required",
  BASIC_DETAILS = "basic_details",
  BASIC_DETAILS_COLLECTED = "basic_details_collected",
  COLLECTED = "collected",
  ELIGIBLE = "eligible",
  NOT_ELIGIBLE = "not_eligible",
  DOCUMENTS_REQUESTED = "documents_requested",
  DOCUMENTS_PARTIALLY_RECEIVED = "documents_partially_received",
  DOCUMENTS_RECEIVED = "documents_received",
  DOCUMENTS_VERIFIED = "documents_verified",
  DOCUMENTS_REJECTED = "documents_rejected",
  DOCUMENTS_PENDING = "documents_pending",
  APPLICATION_IN_PROGRESS = "application_in_progress",
  DROPPED_LOST = "dropped_lost",
  DUPLICATE = "duplicate",
  LOGIN_DONE = "login_done",
  SUBMITTED_TO_BANK_NBFC = "submitted_to_bank_nbfc",
  MULTIPLE_BANKS_APPLIED = "multiple_banks_applied",
  BANK_QUERY_RAISED = "bank_query_raised",
  BANK_QUERY_RESOLVED = "bank_query_resolved",
  LOGIN_APPROVED = "login_approved",
  SANCTIONED = "sanctioned",
  APPROVED_WITH_CONDITIONS = "approved_with_conditions",
  REJECTED_BY_BANK = "rejected_by_bank",
  AGREEMENT_SIGNED = "agreement_signed",
  DISBURSAL_INITIATED = "disbursal_initiated",
  DISBURSED_PARTIAL_FULL = "disbursed_partial_full",
  COMPLETED_SUCCESS = "completed_success",
  CANCELLED_BY_CUSTOMER = "cancelled_by_customer",
  FUTURE_FOLLOW_UP = "future_follow_up",
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
  isDeleted?: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
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
  channelAgency?: Types.ObjectId;
  ownerAgency?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdByName?: string;
  createdByRole?: string;
  updatedByName?: string;
  activities: IInsuranceQueryActivity[];
  followUpEnabled?: boolean;
  nextFollowUp?: IInsuranceQueryFollowUp;
  followUpHistory?: IInsuranceQueryFollowUpHistory[];

  // Commission tracking
  commissionRecorded: boolean;
  commissionRecordedAt?: Date;
  commissionTransactionId?: Types.ObjectId;
  agencyCommissionRecorded?: boolean;
  agencyCommissionRecordedAt?: Date;
  agencyCommissionTransactionId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const InsuranceQuerySchema = new Schema<IInsuranceQuery>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
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
      ref: "Admin",
      index: true,
    },
    assignedLander: {
      type: Schema.Types.ObjectId,
      ref: "Lander",
      index: true,
    },
    channelAgency: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      index: true,
    },
    ownerAgency: {
      type: Schema.Types.ObjectId,
      ref: "Agency",
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      index: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      index: true,
    },
    createdByName: { type: String, trim: true },
    createdByRole: { type: String, trim: true },
    updatedByName: { type: String, trim: true },
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
    followUpEnabled: { type: Boolean, default: false, index: true },
    nextFollowUp: {
      dueAt: { type: Date, index: true },
      type: {
        type: String,
        enum: Object.values(InsuranceFollowUpType),
        default: InsuranceFollowUpType.CALL,
      },
      reason: { type: String, trim: true },
      assignedTo: {
        type: Schema.Types.ObjectId,
        ref: "Admin",
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(InsuranceFollowUpStatus),
        default: InsuranceFollowUpStatus.PENDING,
        index: true,
      },
      priority: {
        type: String,
        enum: Object.values(InsuranceFollowUpPriority),
        default: InsuranceFollowUpPriority.MEDIUM,
      },
      outcome: { type: String, trim: true },
      remark: { type: String, trim: true },
      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "Admin",
      },
      updatedByName: { type: String, trim: true },
      createdAt: { type: Date },
      updatedAt: { type: Date },
    },
    followUpHistory: {
      type: [
        {
          dueAt: { type: Date },
          type: {
            type: String,
            enum: Object.values(InsuranceFollowUpType),
          },
          reason: { type: String, trim: true },
          assignedTo: {
            type: Schema.Types.ObjectId,
            ref: "Admin",
          },
          status: {
            type: String,
            enum: Object.values(InsuranceFollowUpStatus),
          },
          priority: {
            type: String,
            enum: Object.values(InsuranceFollowUpPriority),
          },
          outcome: { type: String, trim: true },
          remark: { type: String, trim: true },
          action: {
            type: String,
            enum: ["scheduled", "completed", "missed", "cancelled", "updated"],
          },
          updatedBy: {
            type: Schema.Types.ObjectId,
            ref: "Admin",
          },
          updatedByName: { type: String, trim: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    // Commission tracking
    commissionRecorded: { type: Boolean, default: false, index: true },
    commissionRecordedAt: { type: Date },
    commissionTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "WalletTransaction",
    },
    agencyCommissionRecorded: { type: Boolean, default: false, index: true },
    agencyCommissionRecordedAt: { type: Date },
    agencyCommissionTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "AgencyCommissionTransaction",
    },
  },
  { timestamps: true },
);

InsuranceQuerySchema.index({ mobile: 1, email: 1 });
InsuranceQuerySchema.index({ customerId: 1 });
InsuranceQuerySchema.index({ ownerAgency: 1, status: 1, createdAt: -1 });
InsuranceQuerySchema.index({
  followUpEnabled: 1,
  "nextFollowUp.status": 1,
  "nextFollowUp.dueAt": 1,
});

InsuranceQuerySchema.pre(/^find/, function (this: any, next) {
  const query = this.getQuery();
  if (Object.prototype.hasOwnProperty.call(query, "isDeleted")) {
    return next();
  }
  this.where({ isDeleted: { $ne: true } });
  next();
});

export const InsuranceQuery = mongoose.model<IInsuranceQuery>(
  "InsuranceQuery",
  InsuranceQuerySchema,
);
