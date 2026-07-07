import { Gender } from "./user.model";
import { generateLoanId } from "../utils/loanId";
import { ApplicationStatus } from "./insurancequery.model";
import mongoose, { Schema, Document, Types } from "mongoose";

export enum AllowedDocumentType {
  PAN_CARD = "pan_card",
  AADHAAR_CARD = "aadhaar_card",
  PHOTO = "photo",
  ITR_FORM_16 = "itr_form_16",
  SALARY_SLIP = "salary_slip",
  OFFER_LETTER = "offer_letter",
  RELIEVING_LETTER = "relieving_letter",
  BANK_STATEMENT = "bank_statement",
  GST_CERTIFICATE = "gst_certificate",
  GST_RETURNS = "gst_returns",
  SHOP_ACT = "shop_act",
  GOVT_LICENSE = "govt_license",
}

// Allowed document types array for validation
export const allowedDocumentTypes = Object.values(AllowedDocumentType);

export enum LoanType {
  PERSONAL_LOAN = "personal_loan",
  EDUCATION_LOAN = "education_loan",
  VEHICLE_LOAN = "vehicle_loan",
  GOLD_LOAN = "gold_loan",
  LOAN_AGAINST_CAR = "loan_against_car",
  INSTANT_LOAN = "instant_loan",
  LOAN_AGAINST_PROPERTY = "loan_against_property",
  RENOVATION_LOAN = "renovation_loan",
  WORKING_CAPITAL_LOAN = "working_capital_loan",
  LOAN_AGAINST_SECURITY = "loan_against_security",
  MACHINERY_LOAN = "machinery_loan",
  HOME_LOAN = "home_loan",
  BUSINESS_LOAN = "business_loan",
  DOD_LOAN = "dod_loan",
  OD_LOAN = "od_loan",
  INDUSTRIAL_LOAN = "industrial_loan",
  COMMERCIAL_PURCHASES_LOAN = "commercial_purchases_loan",
  CREDIT_CARD = "credit_card",
}

export enum LoanQueryActivityType {
  CREATED = "created",
  UPDATED = "updated",
  STATUS_CHANGED = "status_changed",
  LANDER_ASSIGNED = "lander_assigned",
  AGENT_ASSIGNED = "agent_assigned",
  DOCUMENT_UPLOADED = "document_uploaded",
  NOTE_ADDED = "note_added",
  FOLLOW_UP_UPDATED = "follow_up_updated",
}

export enum LoanFollowUpType {
  CALL = "call",
  WHATSAPP = "whatsapp",
  EMAIL = "email",
  DOCUMENT = "document",
  BANK_UPDATE = "bank_update",
  OTHER = "other",
}

export enum LoanFollowUpStatus {
  PENDING = "pending",
  DONE = "done",
  MISSED = "missed",
  CANCELLED = "cancelled",
}

export enum LoanFollowUpPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export interface ILoanQueryActivity {
  type: LoanQueryActivityType;
  description?: string;
  actor?: Types.ObjectId;
  actorModel?: "Admin" | "Agent" | "Lander" | "User";
  payload?: Record<string, any>;
  createdAt: Date;
}

export interface ILoanQueryFollowUp {
  dueAt?: Date;
  type?: LoanFollowUpType;
  reason?: string;
  assignedTo?: Types.ObjectId;
  status?: LoanFollowUpStatus;
  priority?: LoanFollowUpPriority;
  outcome?: string;
  remark?: string;
  updatedBy?: Types.ObjectId;
  updatedByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ILoanQueryFollowUpHistory extends ILoanQueryFollowUp {
  action?: "scheduled" | "completed" | "missed" | "cancelled" | "updated";
}

// Allowed fields mapping based on loan type
export const allowedFieldsByFormType: Record<string, string[]> = {
  [LoanType.PERSONAL_LOAN]: [
    "purpose",
    "existingEmisOrLoans",
    "tenure",
    "salarySlipUrl",
  ],
  [LoanType.EDUCATION_LOAN]: [
    "studentName",
    "courseName",
    "instituteName",
    "countryOfStudy",
    "courseDuration",
    "totalCourseFee",
    "coApplicantParentName",
    "admissionLetterUrl",
    "feeStructureUrl",
    "tenure",
  ],
  [LoanType.VEHICLE_LOAN]: [
    "vehicleType",
    "carLoanType",
    "carRegistrationNumber",
    "carOwnerName",
    "carFatherName",
    "carRegistrationDate",
    "carRegisteredAt",
    "carCategory",
    "carMakerDescription",
    "carBodyType",
    "carFuelType",
    "carColor",
    "carChassisNumber",
    "carEngineNumber",
    "carInsuranceCompany",
    "carInsuranceUpto",
    "carFinancer",
    "carRcStatus",
    "carMakeModel",
    "yearOfManufacture",
    "vehicleValue",
    "dealerName",
    "downPaymentAmount",
    "tenure",
    "rcCopyUrl",
  ],
  [LoanType.GOLD_LOAN]: [
    "goldType",
    "weightInGrams",
    "purity",
    "estimatedValue",
    "tenure",
    "goldPhotosUrl",
  ],
  [LoanType.LOAN_AGAINST_CAR]: [
    "carRegistrationNumber",
    "carCompanyAndModel",
    "yearOfManufacture",
    "carIdentificationNumber",
    "carInsuranceUrl",
  ],
  [LoanType.INSTANT_LOAN]: [
    "employmentType",
    "salarySlipUrl",
    "lastMonthBankStatementUrl",
    "cibilCheckConsent",
  ],
  [LoanType.LOAN_AGAINST_PROPERTY]: [
    "propertyType",
    "propertyAddress",
    "propertyOwnerName",
    "estimatedMarketValue",
    "propertyDocumentsUrl",
    "propertyAge",
    "coApplicants",
  ],
  [LoanType.RENOVATION_LOAN]: [
    "propertyOwnershipProofUrl",
    "estimatedRenovationCost",
    "contractorArchitectName",
    "renovationEstimateUrl",
  ],
  [LoanType.WORKING_CAPITAL_LOAN]: [
    "businessRegistrationType",
    "businessVintage",
    "annualTurnover",
    "gstNumber",
    "itrUrl",
    "gstReturnsUrl",
  ],
  [LoanType.LOAN_AGAINST_SECURITY]: [
    "typeOfSecurity",
    "securityValue",
    "dematAccountNumber",
    "nameOfDepository",
    "dematStatementOrFdCopyUrl",
  ],
  [LoanType.MACHINERY_LOAN]: [
    "typeOfMachinery",
    "newOrUsed",
    "machineryCost",
    "vendorSupplierName",
    "proformaInvoiceOrQuotationUrl",
    "expectedDeliveryDate",
  ],
  [LoanType.HOME_LOAN]: [
    "propertyType",
    "propertyLocation",
    "propertyValue",
    "ownershipType",
    "builderSellerName",
    "propertyDocumentsUrl",
    "tenure",
    "preferredBank",
    "coApplicants",
  ],
  [LoanType.BUSINESS_LOAN]: [
    "businessName",
    "businessType",
    "natureOfBusiness",
    "businessVintage",
    "annualTurnover",
    "purposeOfLoan",
    "collateralAvailable",
    "gstReturnsUrl",
    "businessRegistrationCertificateUrl",
    "tenure",
  ],
  [LoanType.DOD_LOAN]: [],
  [LoanType.OD_LOAN]: [],
  [LoanType.INDUSTRIAL_LOAN]: [],
  [LoanType.COMMERCIAL_PURCHASES_LOAN]: [],
  [LoanType.CREDIT_CARD]: [],
};

export interface ILoanQuery extends Document {
  customerId: Types.ObjectId;
  loanId?: string;
  rcLookup?: Record<string, any>;
  isDeleted?: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  // Personal Details
  loanAmount: number;
  disbursedAmount?: number;
  disbursedDate?: Date;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: Gender;
  marriedStatus: string;
  mobile: string;
  isMobileVerified: boolean;
  email?: string;
  isEmailVerified: boolean;
  panNumber: string;
  aadhaarNumber: string;

  // Contact & Address
  pincode: string;
  state: string;
  city: string;
  street: string;
  leadBy?: string;
  dataSource?: string;
  createdByName?: string;
  createdByRole?: string;
  updatedByName?: string;

  // Professional Details
  employmentType: string; // Self-employed, Self Employed Professional, Self Employed Non-Professional
  industry?: string;
  companyName: string;
  monthlyIncome: number;
  workExperience?: number; // in years
  officeAddress: string;

  // Bank Details
  bankName: string;
  accountType: string;
  accountNumber: string;
  ifscCode: string;
  bankStatementUrl: string;

  // Loan Type & Status
  loanType: LoanType;
  status: ApplicationStatus;
  approved?: boolean; // New field for approval status

  // Mixed policyDetails for other dynamic fields
  policyDetails?: Record<string, any>;

  // Mixed documents field for document uploads
  documents?: Record<string, any>;

  assignedAgent?: Types.ObjectId;
  assignedAgents?: Types.ObjectId[];
  assignedLander?: Types.ObjectId;
  channelAgency?: Types.ObjectId;
  ownerAgency?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  activities: ILoanQueryActivity[];
  followUpEnabled?: boolean;
  nextFollowUp?: ILoanQueryFollowUp;
  followUpHistory?: ILoanQueryFollowUpHistory[];

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

const LoanQuerySchema = new Schema<ILoanQuery>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Personal Details
    loanAmount: { type: Number, required: true },
    disbursedAmount: { type: Number },
    disbursedDate: { type: Date },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    gender: {
      type: String,
      enum: Object.values(Gender),
      required: true,
    },
    marriedStatus: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true, index: true },
    isMobileVerified: { type: Boolean, default: false },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
      default: "",
    },
    isEmailVerified: { type: Boolean, default: false },
    panNumber: { type: String, required: true, trim: true, uppercase: true },
    aadhaarNumber: { type: String, required: true, trim: true },

    // Contact & Address
    pincode: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    street: { type: String, required: true, trim: true },
    leadBy: { type: String, trim: true },
    dataSource: { type: String, trim: true },
    createdByName: { type: String, trim: true },
    createdByRole: { type: String, trim: true },
    updatedByName: { type: String, trim: true },

    // Professional Details
    employmentType: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "self_employed",
        "self_employed_professional",
        "self_employed_non_professional",
        "salaried",
      ],
    },
    industry: { type: String, trim: true },
    companyName: { type: String, required: true, trim: true },
    monthlyIncome: { type: Number, required: true },
    workExperience: { type: Number }, // in years
    officeAddress: { type: String, required: true, trim: true },

    // Bank Details
    bankName: { type: String, required: true, trim: true },
    accountType: {
      type: String,
      required: true,
      trim: true,
      enum: ["savings", "current", "salary"],
    },
    accountNumber: { type: String, required: true, trim: true },
    ifscCode: { type: String, required: true, trim: true, uppercase: true },
    bankStatementUrl: { type: String, trim: true },

    // Loan Type & Status
    loanId: {
      type: String,
      trim: true,
      index: true,
      unique: true,
      sparse: true,
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
    loanType: {
      type: String,
      enum: Object.values(LoanType),
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
    approved: { type: Boolean, default: false, index: true },

    // Mixed policyDetails for other dynamic fields
    policyDetails: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Mixed documents field for document uploads
    documents: {
      type: Schema.Types.Mixed,
      default: {},
      validate: {
        validator: function (value: Record<string, any>) {
          if (
            !value ||
            typeof value !== "object" ||
            Object.keys(value).length === 0
          ) {
            return true; // Allow empty object
          }
          // Check if all keys in documents are allowed document types
          return Object.keys(value).every((docKey) =>
            allowedDocumentTypes.includes(docKey as AllowedDocumentType),
          );
        },
        message: function (props: any) {
          const invalidDocs = Object.keys(props.value || {}).filter(
            (doc) => !allowedDocumentTypes.includes(doc as AllowedDocumentType),
          );
          return `Document type(s) "${invalidDocs.join(", ")}" is/are not allowed. Allowed document types: ${allowedDocumentTypes.join(", ")}`;
        },
      },
    },
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      index: true,
    },
    assignedAgents: [
      {
        type: Schema.Types.ObjectId,
        ref: "Admin",
        index: true,
      },
    ],
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
    activities: {
      type: [
        {
          type: {
            type: String,
            enum: Object.values(LoanQueryActivityType),
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
        enum: Object.values(LoanFollowUpType),
        default: LoanFollowUpType.CALL,
      },
      reason: { type: String, trim: true },
      assignedTo: { type: Schema.Types.ObjectId, ref: "Admin", index: true },
      status: {
        type: String,
        enum: Object.values(LoanFollowUpStatus),
        default: LoanFollowUpStatus.PENDING,
        index: true,
      },
      priority: {
        type: String,
        enum: Object.values(LoanFollowUpPriority),
        default: LoanFollowUpPriority.MEDIUM,
      },
      outcome: { type: String, trim: true },
      remark: { type: String, trim: true },
      updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
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
            enum: Object.values(LoanFollowUpType),
            default: LoanFollowUpType.CALL,
          },
          reason: { type: String, trim: true },
          assignedTo: { type: Schema.Types.ObjectId, ref: "Admin" },
          status: {
            type: String,
            enum: Object.values(LoanFollowUpStatus),
            default: LoanFollowUpStatus.PENDING,
          },
          priority: {
            type: String,
            enum: Object.values(LoanFollowUpPriority),
            default: LoanFollowUpPriority.MEDIUM,
          },
          outcome: { type: String, trim: true },
          remark: { type: String, trim: true },
          action: {
            type: String,
            enum: ["scheduled", "completed", "missed", "cancelled", "updated"],
            default: "updated",
          },
          updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
          updatedByName: { type: String, trim: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    rcLookup: {
      type: Schema.Types.Mixed,
      default: null,
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

LoanQuerySchema.index({ mobile: 1, email: 1 });
LoanQuerySchema.index({ customerId: 1 });
LoanQuerySchema.index({ loanType: 1, createdAt: -1 });
LoanQuerySchema.index({ loanType: 1, status: 1, createdAt: -1 });
LoanQuerySchema.index({ ownerAgency: 1, status: 1, createdAt: -1 });
LoanQuerySchema.index({
  followUpEnabled: 1,
  "nextFollowUp.status": 1,
  "nextFollowUp.dueAt": 1,
});

LoanQuerySchema.pre(/^find/, function (this: any, next) {
  const query = this.getQuery();
  if (Object.prototype.hasOwnProperty.call(query, "isDeleted")) {
    return next();
  }
  this.where({ isDeleted: { $ne: true } });
  next();
});

LoanQuerySchema.pre("save", async function (next) {
  const doc = this as ILoanQuery;
  if (!doc.isNew || doc.loanId) return next();
  try {
    const session = doc.$session();
    doc.loanId = await generateLoanId(session || undefined);
    return next();
  } catch (error) {
    return next(error as any);
  }
});

export const LoanQuery = mongoose.model<ILoanQuery>(
  "LoanQuery",
  LoanQuerySchema,
);
