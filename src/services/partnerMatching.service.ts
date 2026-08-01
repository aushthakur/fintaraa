import mongoose from "mongoose";
import ApiError from "../utils/ApiError";
import { LoanQuery } from "../modals/loanquery.model";
import { InsuranceQuery } from "../modals/insurancequery.model";
import { User } from "../modals/user.model";
import {
  PartnerApplicationType,
  IPartnerMatchCheck,
} from "../modals/partnerAssignment.model";
import {
  PartnerProduct,
  PartnerIncomePeriod,
} from "../modals/partnerProduct.model";
import {
  PartnerProductCategory,
  PartnerStatus,
} from "../modals/partner.model";

type ApplicationContext = {
  record: Record<string, any>;
  applicationType: PartnerApplicationType;
  applicationModel: "LoanQuery" | "InsuranceQuery";
  application: mongoose.Types.ObjectId;
  applicationId: string;
  productType: string;
  city: string;
  pincode: string;
  amount?: number;
  monthlyIncome?: number;
  annualIncome?: number;
  cibilScore?: number;
  employmentType: string;
  age?: number;
  companyCategory: string;
};

export type PartnerMatchResult = {
  partner: Record<string, any>;
  product: Record<string, any>;
  score: number;
  eligible: boolean;
  reasons: string[];
  checks: IPartnerMatchCheck[];
};

const asNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const normalizeComparablePartnerProductType = (value: unknown) =>
  normalizeToken(value).replace(/_/g, "");

const normalizeEmployment = (value: unknown) => {
  const token = normalizeToken(value).replace(/_/g, "");
  if (["salary", "salaried", "employee", "employed"].includes(token)) {
    return "salaried";
  }
  if (["selfemployedprofessional", "selfprofessional"].includes(token)) {
    return "self_employed_professional";
  }
  if (
    [
      "selfemployednonprofessional",
      "selfemployed",
      "business",
      "businessowner",
    ].includes(token)
  ) {
    return token === "business" || token === "businessowner"
      ? "business_owner"
      : "self_employed";
  }
  return normalizeToken(value);
};

const calculateAge = (dateOfBirth: unknown) => {
  if (!dateOfBirth) return undefined;
  const birth = new Date(String(dateOfBirth));
  if (Number.isNaN(birth.getTime()) || birth > new Date()) return undefined;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDifference = today.getUTCMonth() - birth.getUTCMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

const resolveMongoOrDisplayQuery = (id: string, displayField: string) => {
  const clauses: Record<string, any>[] = [{ [displayField]: id }];
  if (mongoose.isValidObjectId(id)) {
    clauses.unshift({ _id: new mongoose.Types.ObjectId(id) });
  }
  return { $or: clauses };
};

export const getPartnerApplicationContext = async (
  applicationType: PartnerApplicationType,
  id: string,
): Promise<ApplicationContext> => {
  const applicationId = String(id || "").trim();
  if (!applicationId) throw new ApiError(400, "applicationId is required");

  const record =
    applicationType === PartnerApplicationType.LOAN
      ? await LoanQuery.findOne(
          resolveMongoOrDisplayQuery(applicationId, "loanId"),
        ).lean()
      : await InsuranceQuery.findOne(
          resolveMongoOrDisplayQuery(applicationId, "insuranceId"),
        ).lean();

  if (!record) throw new ApiError(404, "Application not found");

  const raw = record as Record<string, any>;
  const customer = raw.customerId
    ? ((await User.findById(raw.customerId)
        .select(
          "cibilScore dateOfBirth employmentDetails financialProfile personalDetails",
        )
        .lean()) as Record<string, any> | null)
    : null;
  const policy = raw.policyDetails || {};
  const isLoan = applicationType === PartnerApplicationType.LOAN;
  const monthlyIncome = asNumber(
    raw.monthlyIncome ??
      policy.monthlyIncome ??
      customer?.financialProfile?.monthlyIncome ??
      customer?.employmentDetails?.monthlyIncome,
  );
  const annualIncome = asNumber(
    raw.annualIncome ??
      policy.annualIncome ??
      customer?.financialProfile?.annualIncome ??
      (monthlyIncome !== undefined ? monthlyIncome * 12 : undefined),
  );
  const amount = asNumber(
    isLoan
      ? raw.loanAmount
      : policy.coverageAmount ??
          policy.coverageRequired ??
          policy.sumAssured ??
          policy.sumInsured ??
          policy.propertyValue,
  );

  return {
    record: raw,
    applicationType,
    applicationModel: isLoan ? "LoanQuery" : "InsuranceQuery",
    application: raw._id,
    applicationId: String(
      (isLoan ? raw.loanId : raw.insuranceId) || raw._id,
    ),
    productType: normalizeToken(isLoan ? raw.loanType : raw.typeOfInsurance),
    city: String(raw.city || policy.city || "").trim(),
    pincode: String(raw.pincode || policy.pincode || "")
      .trim()
      .replace(/\s+/g, ""),
    amount,
    monthlyIncome,
    annualIncome,
    cibilScore: asNumber(raw.cibilScore ?? customer?.cibilScore),
    employmentType: normalizeEmployment(
      raw.employmentType ??
        raw.occupation ??
        policy.employmentType ??
        customer?.employmentDetails?.employmentType,
    ),
    age: calculateAge(raw.dateOfBirth ?? customer?.dateOfBirth),
    companyCategory: String(
      policy.companyCategory ?? raw.companyCategory ?? "",
    ).trim(),
  };
};

const expectedRange = (min?: number, max?: number) => ({
  ...(min !== undefined ? { min } : {}),
  ...(max !== undefined ? { max } : {}),
});

const rangeCheck = (args: {
  field: string;
  label: string;
  actual?: number;
  min?: number;
  max?: number;
  weight: number;
  unit?: string;
}): IPartnerMatchCheck => {
  const configured = args.min !== undefined || args.max !== undefined;
  if (!configured) {
    return {
      field: args.field,
      label: args.label,
      skipped: true,
      passed: null,
      weight: 0,
      score: 0,
      reason: `${args.label} has no partner restriction`,
    };
  }
  if (args.actual === undefined) {
    return {
      field: args.field,
      label: args.label,
      actual: null,
      expected: expectedRange(args.min, args.max),
      passed: null,
      weight: args.weight,
      score: 0,
      reason: `${args.label} is unavailable for this application`,
    };
  }
  const passed =
    (args.min === undefined || args.actual >= args.min) &&
    (args.max === undefined || args.actual <= args.max);
  const expected = [
    args.min !== undefined ? `minimum ${args.min}` : "",
    args.max !== undefined ? `maximum ${args.max}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return {
    field: args.field,
    label: args.label,
    actual: args.actual,
    expected: expectedRange(args.min, args.max),
    passed,
    weight: args.weight,
    score: passed ? args.weight : 0,
    reason: passed
      ? `${args.label} ${args.actual}${args.unit || ""} meets ${expected}`
      : `${args.label} ${args.actual}${args.unit || ""} does not meet ${expected}`,
  };
};

const listCheck = (args: {
  field: string;
  label: string;
  actual: string;
  allowed: string[];
  weight: number;
  normalize?: (value: unknown) => string;
}): IPartnerMatchCheck => {
  const normalize = args.normalize || normalizeToken;
  const allowed = (args.allowed || []).map(normalize).filter(Boolean);
  if (!allowed.length) {
    return {
      field: args.field,
      label: args.label,
      skipped: true,
      passed: null,
      weight: 0,
      score: 0,
      reason: `${args.label} has no partner restriction`,
    };
  }
  const actual = normalize(args.actual);
  if (!actual) {
    return {
      field: args.field,
      label: args.label,
      actual: null,
      expected: args.allowed,
      passed: null,
      weight: args.weight,
      score: 0,
      reason: `${args.label} is unavailable for this application`,
    };
  }
  const passed = allowed.includes(actual);
  return {
    field: args.field,
    label: args.label,
    actual: args.actual,
    expected: args.allowed,
    passed,
    weight: args.weight,
    score: passed ? args.weight : 0,
    reason: passed
      ? `${args.label} is serviced by this partner`
      : `${args.label} is outside this partner's configured rules`,
  };
};

const scoreProduct = (
  context: ApplicationContext,
  product: Record<string, any>,
): PartnerMatchResult => {
  const partner = product.partner as Record<string, any>;
  const eligibility = product.eligibility || {};
  const partnerAreas = partner.serviceAreas || {};
  const productType = normalizeComparablePartnerProductType(
    product.productType,
  );
  const applicationProductType = normalizeComparablePartnerProductType(
    context.productType,
  );
  const acceptsAnyProduct = ["all", "any", "generic"].includes(productType);
  const typePassed =
    acceptsAnyProduct || productType === applicationProductType;
  const typeCheck: IPartnerMatchCheck = {
    field: "productType",
    label: "Product type",
    actual: context.productType,
    expected: product.productType,
    passed: typePassed,
    weight: 20,
    score: typePassed ? 20 : 0,
    reason: typePassed
      ? "Application and partner product types match"
      : "Application and partner product types do not match",
  };
  const income =
    eligibility.incomePeriod === PartnerIncomePeriod.ANNUAL
      ? context.annualIncome ??
        (context.monthlyIncome !== undefined
          ? context.monthlyIncome * 12
          : undefined)
      : context.monthlyIncome ??
        (context.annualIncome !== undefined
          ? context.annualIncome / 12
          : undefined);
  const cities = eligibility.cities?.length
    ? eligibility.cities
    : partnerAreas.countrywide
      ? []
      : partnerAreas.cities || [];
  const pincodes = eligibility.pincodes?.length
    ? eligibility.pincodes
    : partnerAreas.countrywide
      ? []
      : partnerAreas.pincodes || [];

  const checks: IPartnerMatchCheck[] = [
    typeCheck,
    rangeCheck({
      field: "cibilScore",
      label: "CIBIL score",
      actual: context.cibilScore,
      min: asNumber(eligibility.cibilMin),
      max: asNumber(eligibility.cibilMax),
      weight: 15,
    }),
    rangeCheck({
      field: "income",
      label:
        eligibility.incomePeriod === PartnerIncomePeriod.ANNUAL
          ? "Annual income"
          : "Monthly income",
      actual: income,
      min: asNumber(eligibility.incomeMin),
      max: asNumber(eligibility.incomeMax),
      weight: 15,
    }),
    listCheck({
      field: "employmentType",
      label: "Employment type",
      actual: context.employmentType,
      allowed: eligibility.employmentTypes || [],
      weight: 10,
      normalize: normalizeEmployment,
    }),
    rangeCheck({
      field: "amount",
      label:
        context.applicationType === PartnerApplicationType.LOAN
          ? "Loan amount"
          : "Coverage amount",
      actual: context.amount,
      min: asNumber(product.amountMin),
      max: asNumber(product.amountMax),
      weight: 15,
    }),
    rangeCheck({
      field: "age",
      label: "Applicant age",
      actual: context.age,
      min: asNumber(eligibility.ageMin),
      max: asNumber(eligibility.ageMax),
      weight: 10,
      unit: " years",
    }),
    listCheck({
      field: "city",
      label: "City",
      actual: context.city,
      allowed: cities,
      weight: 10,
    }),
    listCheck({
      field: "pincode",
      label: "Pincode",
      actual: context.pincode,
      allowed: pincodes,
      weight: 10,
      normalize: (value) => String(value || "").replace(/\s+/g, ""),
    }),
    listCheck({
      field: "companyCategory",
      label: "Company category",
      actual: context.companyCategory,
      allowed: eligibility.companyCategories || [],
      weight: 5,
    }),
  ];
  const applicable = checks.filter((check) => !check.skipped);
  const availableWeight = applicable.reduce(
    (sum, check) => sum + Number(check.weight || 0),
    0,
  );
  const earnedWeight = applicable.reduce(
    (sum, check) => sum + Number(check.score || 0),
    0,
  );
  const score = availableWeight
    ? Math.round((earnedWeight / availableWeight) * 100)
    : 0;
  const eligible = applicable.every((check) => check.passed === true);
  const reasons = applicable
    .filter((check) => check.passed !== true)
    .map((check) => check.reason);

  return {
    partner,
    product: { ...product, partner: partner._id },
    score,
    eligible,
    reasons:
      reasons.length > 0
        ? reasons
        : ["All configured partner eligibility rules are satisfied"],
    checks,
  };
};

export const matchPartnerProducts = async (args: {
  applicationType: PartnerApplicationType;
  applicationId: string;
  category?: PartnerProductCategory;
}) => {
  const context = await getPartnerApplicationContext(
    args.applicationType,
    args.applicationId,
  );
  const category =
    args.category ||
    (args.applicationType === PartnerApplicationType.LOAN
      ? PartnerProductCategory.LOAN
      : PartnerProductCategory.INSURANCE);
  const products = (await PartnerProduct.find({
    category,
    active: true,
    published: true,
    assignmentEnabled: true,
    isDeleted: false,
  })
    .populate({
      path: "partner",
      match: { status: PartnerStatus.ACTIVE, isDeleted: false },
    })
    .sort({ priority: 1, name: 1 })
    .lean()) as unknown as Record<string, any>[];

  const matches = products
    .filter((product) => product.partner)
    .map((product) => scoreProduct(context, product))
    .sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        right.score - left.score ||
        Number(left.product.priority || 100) -
          Number(right.product.priority || 100),
    );

  return {
    context,
    application: {
      id: context.application,
      applicationId: context.applicationId,
      applicationType: context.applicationType,
      productType: context.productType,
      city: context.city,
      pincode: context.pincode,
      amount: context.amount ?? null,
      monthlyIncome: context.monthlyIncome ?? null,
      annualIncome: context.annualIncome ?? null,
      cibilScore: context.cibilScore ?? null,
      employmentType: context.employmentType || null,
      age: context.age ?? null,
    },
    matches,
  };
};
