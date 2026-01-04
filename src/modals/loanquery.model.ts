import mongoose, { Schema, Document, Types } from "mongoose";
import { Gender } from "./user.model";
import { ApplicationStatus } from "./insurancequery.model";

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
}

export enum LoanQueryActivityType {
  CREATED = "created",
  UPDATED = "updated",
  STATUS_CHANGED = "status_changed",
  LANDER_ASSIGNED = "lander_assigned",
  AGENT_ASSIGNED = "agent_assigned",
  DOCUMENT_UPLOADED = "document_uploaded",
  NOTE_ADDED = "note_added",
}

export interface ILoanQueryActivity {
  type: LoanQueryActivityType;
  description?: string;
  actor?: Types.ObjectId;
  actorModel?: "Admin" | "Agent" | "Lander" | "User";
  payload?: Record<string, any>;
  createdAt: Date;
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
};

export interface ILoanQuery extends Document {
  customerId: Types.ObjectId;
  // Personal Details
  loanAmount: number;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: Gender;
  marriedStatus: string;
  mobile: string;
  isMobileVerified: boolean;
  email: string;
  isEmailVerified: boolean;
  panNumber: string;
  aadhaarNumber: string;
  
  // Contact & Address
  pincode: string;
  state: string;
  city: string;
  street: string;
  
  // Professional Details
  employmentType: string; // Self-employed, Self Employed Professional, Self Employed Non-Professional
  industry: string;
  companyName: string;
  monthlyIncome: number;
  workExperience: number; // in years
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
  
  // Mixed policyDetails for other dynamic fields
  policyDetails?: Record<string, any>;
  
  // Mixed documents field for document uploads
  documents?: Record<string, any>;
  
  assignedAgent?: Types.ObjectId;
  assignedLander?: Types.ObjectId;
  activities: ILoanQueryActivity[];
  
  // Commission tracking
  commissionRecorded: boolean;
  commissionRecordedAt?: Date;
  commissionTransactionId?: Types.ObjectId;
  
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
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    isEmailVerified: { type: Boolean, default: false },
    panNumber: { type: String, required: true, trim: true, uppercase: true },
    aadhaarNumber: { type: String, required: true, trim: true },
    
    // Contact & Address
    pincode: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    street: { type: String, required: true, trim: true },
    
    // Professional Details
    employmentType: { 
      type: String, 
      required: true, 
      trim: true,
      enum: ["self_employed", "self_employed_professional", "self_employed_non_professional", "salaried"],
    },
    industry: { type: String, required: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    monthlyIncome: { type: Number, required: true },
    workExperience: { type: Number, required: true }, // in years
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
          if (!value || typeof value !== "object" || Object.keys(value).length === 0) {
            return true; // Allow empty object
          }
          // Check if all keys in documents are allowed document types
          return Object.keys(value).every((docKey) => allowedDocumentTypes.includes(docKey as AllowedDocumentType));
        },
        message: function (props: any) {
          const invalidDocs = Object.keys(props.value || {}).filter(
            (doc) => !allowedDocumentTypes.includes(doc as AllowedDocumentType)
          );
          return `Document type(s) "${invalidDocs.join(", ")}" is/are not allowed. Allowed document types: ${allowedDocumentTypes.join(", ")}`;
        },
      },
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
    // Commission tracking
    commissionRecorded: { type: Boolean, default: false, index: true },
    commissionRecordedAt: { type: Date },
    commissionTransactionId: { type: Schema.Types.ObjectId, ref: "WalletTransaction" },
  },
  { timestamps: true }
);

LoanQuerySchema.index({ mobile: 1, email: 1 });
LoanQuerySchema.index({ customerId: 1 });

export const LoanQuery = mongoose.model<ILoanQuery>(
  "LoanQuery",
  LoanQuerySchema
);
