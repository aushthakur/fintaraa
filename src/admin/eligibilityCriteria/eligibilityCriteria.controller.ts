import { NextFunction, Request, Response } from "express";
import axios from "axios";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import {
  EligibilityAmountType,
  EligibilityCriteria,
  EligibilityCriteriaStatus,
} from "../../modals/eligibilityCriteria.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { createMailOptions } from "../../config/nodeMailerConfig";
import { sendMail } from "../../utils/emailService";
import { checkEligibilityMailAccess } from "../eligibilityMailPermission/eligibilityMailPermission.utils";

const EligibilityCriteriaService = new CommonService(EligibilityCriteria);

const ELIGIBILITY_BASE_FIELDS = [
  "loanType",
  "bankName",
  "salaryType",
  "roi",
  "minAge",
  "maxAge",
  "maxTenureYears",
  "processingFees",
  "processingFeesType",
  "insurance",
  "insuranceType",
  "insuranceValue",
  "propertyInsuranceRequired",
  "propertyInsurancePercentage",
  "lifeInsuranceRequired",
  "lifeInsurancePercentage",
  "loginFees",
  "rm",
  "rmMailId",
  "rmMbNo",
  "asm",
  "asmMailId",
  "asmMbNo",
  "zsm",
  "zsmMailId",
  "zsmMbNo",
  "remarks",
  "status",
  "commissionType",
  "commissionValue",
  "commissionMinAmount",
  "commissionMaxAmount",
  "commissionCapAmount",
] as const;

const ELIGIBILITY_FIELDS_BY_SALARY_TYPE: Record<string, string[]> = {
  salaried: [
    "cibilScore",
    "itrYears",
    "totalExperience",
    "currentExperience",
    "netSalary",
    "currentTotalEmi",
    "businessProgramFresh",
    "companyCategoryBasis",
    "companyCategory",
    "abb",
    "maximumLoanAmount",
  ],
  selfemployed: [
    "cibilScore",
    "itrYears",
    "totalVintage",
    "businessProgramFresh",
    "gstAmount",
    "abb",
    "bankingAmount",
    "itrAmount",
    "nipPdBase",
    "lowLtv",
    "lowLtvMin",
    "lowLtvMax",
  ],
  selfemployedprofessional: [
    "cibilScore",
    "itrYears",
    "totalVintage",
    "businessProgramFresh",
    "receiptsAmount",
    "abb",
    "bankingAmount",
    "itrAmount",
    "nipPdBase",
    "lowLtv",
    "lowLtvMin",
    "lowLtvMax",
  ],
};

const ELIGIBILITY_HOME_PROPERTY_LOAN_TYPES = new Set([
  "home loan",
  "homeloan",
  "loan against property",
  "loanagainstproperty",
]);

const ELIGIBILITY_PROPERTY_FIELDS = [
  "cashRental",
  "bankRental",
  "mixRental",
  "residentialCatALtv",
  "residentialCatBLtv",
  "residentialCatCLtv",
  "commercialCatALtv",
  "commercialCatBLtv",
  "commercialCatCLtv",
  "industrialCatALtv",
  "industrialCatBLtv",
  "industrialCatCLtv",
] as const;

const ELIGIBILITY_FOIR_FIELDS_BY_SALARY_TYPE: Record<string, string[]> = {
  salaried: [
    "salaryFoir0To25000",
    "salaryFoir25000To50000",
    "salaryFoir50000To75000",
    "salaryFoir75000Above",
  ],
  selfemployed: [
    "businessFoir0To600000",
    "businessFoir600000To1000000",
    "businessFoir1000000Above",
    "btMultiplier0To1Year",
    "btMultiplier1To3Years",
    "btMultiplier3YearsAbove",
  ],
  selfemployedprofessional: [
    "itrFoir0To600000",
    "itrFoir600000To1000000",
    "itrFoir1000000Above",
    "btMultiplier0To1Year",
    "btMultiplier1To3Years",
    "btMultiplier3YearsAbove",
    "receiptMultiplier0To1Year",
    "receiptMultiplier1To3Years",
  ],
};

const normalizeEligibilitySalaryType = (value?: any) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!raw) return "";
  if (raw === "salaried" || raw === "salary") return "Salaried";
  if (
    [
      "selfemployedprofessional",
      "selfemployedpro",
      "selfprofessional",
    ].includes(raw)
  ) {
    return "Self Employed Professional";
  }
  if (
    [
      "selfemployed",
      "selfemployednonprofessional",
      "selfemployednonpro",
      "selfnonprofessional",
    ].includes(raw)
  ) {
    return "Self Employed";
  }
  return String(value || "").trim();
};

const getEligibilityFieldGroupKey = (salaryType?: any) => {
  const normalized = normalizeEligibilitySalaryType(salaryType)
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (normalized === "salaried") return "salaried";
  if (normalized === "selfemployedprofessional") {
    return "selfemployedprofessional";
  }
  if (normalized === "selfemployed") return "selfemployed";
  return "";
};

const shouldAllowEligibilityPropertyFields = (loanType?: any) => {
  const normalized = String(loanType || "")
    .trim()
    .toLowerCase();
  return ELIGIBILITY_HOME_PROPERTY_LOAN_TYPES.has(normalized);
};

const validateMonthField = (
  payload: Record<string, any>,
  field: string,
  label: string,
) => {
  const value = payload[field];
  if (value === undefined || value === null || value === "") return;
  const numberValue = Number(value);
  if (
    !Number.isFinite(numberValue) ||
    !Number.isInteger(numberValue) ||
    numberValue < 0 ||
    numberValue > 11
  ) {
    throw new ApiError(400, `${label} must be a whole number from 0 to 11`);
  }
};

const normalizeBooleanFlag = (value: any) => {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return ["yes", "true", "1", "active", "checked"].includes(raw);
};

const normalizeAmountType = (
  value: any,
  fallback: EligibilityAmountType = EligibilityAmountType.PERCENTAGE,
) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  return raw === EligibilityAmountType.FIXED
    ? EligibilityAmountType.FIXED
    : raw === EligibilityAmountType.PERCENTAGE
      ? EligibilityAmountType.PERCENTAGE
      : fallback;
};

const normalizeCompanyCategoryBasis = (value: any) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  return raw === "bank" || raw === "bank based" ? "bank" : "company";
};

const normalizeAbbValue = (value: any) => {
  const rawValues = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  const normalized = rawValues
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 31);

  return Array.from(new Set(normalized)).sort((a, b) => a - b);
};

const sanitizeEligibilityPayload = (payload: Record<string, any>) => {
  const normalizedSalaryType = normalizeEligibilitySalaryType(
    payload.salaryType,
  );
  const fieldGroupKey = getEligibilityFieldGroupKey(normalizedSalaryType);
  const allowedFields = new Set([
    ...ELIGIBILITY_BASE_FIELDS,
    ...(ELIGIBILITY_FIELDS_BY_SALARY_TYPE[fieldGroupKey] || []),
    ...(ELIGIBILITY_FOIR_FIELDS_BY_SALARY_TYPE[fieldGroupKey] || []),
    ...(shouldAllowEligibilityPropertyFields(payload.loanType)
      ? ELIGIBILITY_PROPERTY_FIELDS
      : []),
  ]);

  const normalizedPayload = {
    ...payload,
    salaryType: normalizedSalaryType,
    companyCategory: Array.isArray(payload.companyCategory)
      ? payload.companyCategory
      : payload.companyCategory
        ? [payload.companyCategory]
        : payload.companyCategory,
    abb: payload.abb === undefined ? undefined : normalizeAbbValue(payload.abb),
    cibilScore: payload.cibilScore ?? payload.cibilScoreWithCall,
    nipPdBase: payload.nipPdBase ?? payload.nipPdBaseAmount,
    lowLtvMin: payload.lowLtvMin ?? payload.lowLtvMinimum,
    lowLtvMax: payload.lowLtvMax ?? payload.lowLtvMaximum,
    processingFeesType: normalizeAmountType(payload.processingFeesType),
    insuranceType: normalizeAmountType(
      payload.insuranceType,
      EligibilityAmountType.FIXED,
    ),
    companyCategoryBasis: normalizeCompanyCategoryBasis(
      payload.companyCategoryBasis,
    ),
    ...(payload.propertyInsuranceRequired !== undefined
      ? {
          propertyInsuranceRequired: normalizeBooleanFlag(
            payload.propertyInsuranceRequired,
          ),
        }
      : {}),
    ...(payload.lifeInsuranceRequired !== undefined
      ? {
          lifeInsuranceRequired: normalizeBooleanFlag(
            payload.lifeInsuranceRequired,
          ),
        }
      : {}),
    status: String(payload.status || "")
      .trim()
      .toLowerCase(),
  };

  return Object.fromEntries(
    Object.entries(normalizedPayload).filter(([key, value]) => {
      if (!allowedFields.has(key as any)) return false;
      return value !== undefined;
    }),
  );
};

const formatValue = (value: any) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const humanize = (value: any) =>
  formatValue(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

const buildApplicantRows = (loan: Record<string, any> | null) => {
  if (!loan) return "";
  const applicant = {
    Name: `${loan.firstName || ""} ${loan.lastName || ""}`.trim() || "-",
    Mobile: loan.mobile || "-",
    Email: loan.email || "-",
    "Loan Type": humanize(loan.loanType || "-"),
    "Loan Amount": loan.loanAmount ?? "-",
    "Employment Type": humanize(loan.employmentType || "-"),
    "Monthly Income": loan.monthlyIncome ?? "-",
    "CIBIL Score": loan.cibilScore ?? loan.customerCibilScore ?? "-",
  };

  return Object.entries(applicant)
    .map(
      ([label, value]) =>
        `<tr><td style=\"padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;\">${label}</td><td style=\"padding:6px 10px;border:1px solid #e2e8f0;\">${formatValue(value)}</td></tr>`,
    )
    .join("");
};

const normalizeEmail = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getRecipientEmails = (
  criteriaList: Record<string, any>[],
  recipientType?: string,
) => {
  const emails = criteriaList.flatMap((criteria) => {
    if (recipientType === "rm") {
      return [criteria.rmMailId];
    }

    return [criteria.rmMailId, criteria.asmMailId, criteria.zsmMailId];
  });

  return Array.from(
    new Set(emails.map(normalizeEmail).filter((email) => Boolean(email))),
  );
};

const buildEligibilityMailHtml = (
  loanQuery: Record<string, any> | null,
  criteriaList: Record<string, any>[],
  recipientType?: string,
) => {
  const applicantRows = buildApplicantRows(loanQuery);
  const criteriaRows = criteriaList
    .map((criteria) => {
      const bankName = formatValue(criteria.bankName);
      const rmName = formatValue(criteria.rm);
      const rmMailId = formatValue(criteria.rmMailId);
      const salaryType = formatValue(criteria.salaryType);
      const score = formatValue(
        criteria.cibilScore ?? criteria.cibilScoreWithCall,
      );
      return `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;">${bankName}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${rmName}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${rmMailId}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${salaryType}</td>
          <td style="padding:6px 10px;border:1px solid #e2e8f0;">${score}</td>
        </tr>
      `;
    })
    .join("");

  const recipientLabel = recipientType === "rm" ? "RM" : "Bank Team";

  return `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2 style="margin:0 0 12px;">Eligibility Bank Matches</h2>
      <p style="margin:0 0 12px; font-size:13px; color:#475569;">
        The attached PDF contains the full loan query packet for ${recipientLabel} review.
      </p>
      ${
        applicantRows
          ? `<h3 style="margin:16px 0 8px;">Applicant Summary</h3>
             <table style="border-collapse:collapse; width:100%; font-size:13px;">${applicantRows}</table>`
          : ""
      }
      <h3 style="margin:16px 0 8px;">Matched Criteria</h3>
      <table style="border-collapse:collapse; width:100%; font-size:13px;">
        <tr>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Bank</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">RM</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">RM Email</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Salary Type</th>
          <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">CIBIL Score</th>
        </tr>
        ${criteriaRows}
      </table>
    </div>
  `;
};

const queueEligibilityMailDispatch = async ({
  recipients,
  subject,
  html,
  attachments,
}: {
  recipients: string[];
  subject: string;
  html: string;
  attachments: any[];
}) => {
  const normalizedRecipients = Array.from(
    new Set(recipients.map(normalizeEmail).filter((email) => Boolean(email))),
  );
  console.log("[EligibilityMail] Queue dispatch started", {
    recipients: normalizedRecipients.length,
    attachments: attachments.length,
    subject,
  });

  if (normalizedRecipients.length === 0) {
    console.log(
      "[EligibilityMail] No recipients available for queued dispatch",
    );
    return;
  }

  const [to, ...cc] = normalizedRecipients;
  console.log("[EligibilityMail] Sending queued mail", { to, cc });
  const info = await sendMail(
    createMailOptions(
      to,
      subject,
      html,
      attachments,
      cc.length ? cc : undefined,
    ),
  );
  console.log("[EligibilityMail] Queued mail sent", {
    to,
    cc,
    messageId: info?.messageId,
    accepted: info?.accepted,
    rejected: info?.rejected,
  });
};

type DocumentAttachmentInput = {
  label?: string;
  url?: string;
  source?: string;
};

const sanitizeFilename = (value: string) => {
  const cleaned = value
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "document";
};

const getExtensionFromContentType = (contentType?: string) => {
  if (!contentType) return null;
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return null;
};

const getExtensionFromUrl = (url: string) => {
  const pathname = url.split("?")[0];
  const ext = pathname.split(".").pop();
  if (!ext || ext.length > 5) return null;
  return ext.toLowerCase();
};

const PUBLIC_ELIGIBILITY_SELECT_FIELDS = [
  "loanType",
  "bankName",
  "salaryType",
  "cibilScore",
  "itrYears",
  "businessProgramFresh",
  "gstAmount",
  "bankingAmount",
  "itrAmount",
  "nipPdBase",
  "lowLtv",
  "lowLtvMin",
  "lowLtvMax",
  "salaryFoir0To25000",
  "salaryFoir25000To50000",
  "salaryFoir50000To75000",
  "salaryFoir75000Above",
  "businessFoir0To600000",
  "businessFoir600000To1000000",
  "businessFoir1000000Above",
  "itrFoir0To600000",
  "itrFoir600000To1000000",
  "itrFoir1000000Above",
  "btMultiplier0To1Year",
  "btMultiplier1To3Years",
  "btMultiplier3YearsAbove",
  "receiptMultiplier0To1Year",
  "receiptMultiplier1To3Years",
  "roi",
  "minAge",
  "maxAge",
  "maxTenureYears",
  "cashRental",
  "bankRental",
  "mixRental",
  "residentialCatALtv",
  "residentialCatBLtv",
  "residentialCatCLtv",
  "commercialCatALtv",
  "commercialCatBLtv",
  "commercialCatCLtv",
  "industrialCatALtv",
  "industrialCatBLtv",
  "industrialCatCLtv",
  "processingFees",
  "processingFeesType",
  "insurance",
  "insuranceType",
  "insuranceValue",
  "propertyInsuranceRequired",
  "propertyInsurancePercentage",
  "lifeInsuranceRequired",
  "lifeInsurancePercentage",
  "loginFees",
  "companyCategory",
  "companyCategoryBasis",
  "abb",
  "maximumLoanAmount",
  "currentExperience",
  "totalExperience",
  "totalVintage",
  "netSalary",
  "currentTotalEmi",
  "receiptsAmount",
  "status",
].join(" ");

const PUBLIC_LOAN_TYPE_ALIASES: Record<string, string> = {
  balancetransfer: "balanceTransferLoan",
  balancetransferloan: "balanceTransferLoan",
  balancetransfertopuploan: "balanceTransferLoan",
  topup: "topUpLoan",
  topuploan: "topUpLoan",
  twowheeler: "twoWheelerLoan",
  twowheelerloan: "twoWheelerLoan",
  usedcar: "usedCarLoan",
  usedcarloan: "usedCarLoan",
  agriculture: "agricultureLoan",
  agricultureloan: "agricultureLoan",
  solar: "solarLoan",
  solarloan: "solarLoan",
  personal: "personalLoan",
  personalloan: "personalLoan",
  instant: "instantLoan",
  instantloan: "instantLoan",
  creditscore: "creditScoreLoan",
  creditscoreloan: "creditScoreLoan",
  home: "homeLoan",
  homeloan: "homeLoan",
  construction: "homeLoan",
  constructionloan: "homeLoan",
  business: "businessLoan",
  businessloan: "businessLoan",
  vehicle: "vehicleLoan",
  vehicleloan: "vehicleLoan",
  car: "vehicleLoan",
  carloan: "vehicleLoan",
  vechile: "vehicleLoan",
  vechileloan: "vehicleLoan",
  renovation: "renovationLoan",
  renovationloan: "renovationLoan",
  homerenovation: "renovationLoan",
  workingcapital: "workingCapitalLoan",
  workingcapitalloan: "workingCapitalLoan",
  loanagainstproperty: "loanAgainstProperty",
  lap: "loanAgainstProperty",
  loanagainstsecurity: "loanAgainstSecurity",
  las: "loanAgainstSecurity",
  loanagainstcar: "loanAgainstCarValue",
  loanagainstcarvalue: "loanAgainstCarValue",
  machinery: "machineryLoan",
  machineryloan: "machineryLoan",
  dod: "businessLoan",
  dodloan: "businessLoan",
  od: "workingCapitalLoan",
  odloan: "workingCapitalLoan",
  industrial: "machineryLoan",
  industrialloan: "machineryLoan",
  commercialpurchase: "businessLoan",
  commercialpurchases: "businessLoan",
  commercialpurchasesloan: "businessLoan",
  gold: "goldLoan",
  goldloan: "goldLoan",
  education: "educationLoan",
  educationloan: "educationLoan",
};

const compactPublicKey = (value?: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

const normalizePublicLoanType = (value?: any) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = compactPublicKey(raw);
  if (PUBLIC_LOAN_TYPE_ALIASES[compact]) {
    return PUBLIC_LOAN_TYPE_ALIASES[compact];
  }

  const words = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length <= 1) return raw;
  return words
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join("");
};

const toPublicNumber = (value: any) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const clampPublicLimit = (value: any) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatPublicCurrency = (value?: any) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue === 0) return "";
  return `Rs ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(numberValue)}`;
};

const formatPublicPercent = (value?: number | null, suffix = "%") => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 2)}${suffix}`;
};

const formatPublicAmountByType = (
  value: any,
  type?: any,
  fallback: EligibilityAmountType = EligibilityAmountType.PERCENTAGE,
) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "";
  return normalizeAmountType(type, fallback) === EligibilityAmountType.FIXED
    ? formatPublicCurrency(numberValue)
    : formatPublicPercent(numberValue);
};

const formatPublicYears = (value?: number | null) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "";
  return `${numberValue} ${numberValue === 1 ? "year" : "years"}`;
};

const formatPublicAbb = (value: any) => {
  if (Array.isArray(value)) {
    const days = value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 1 && item <= 31)
      .sort((a, b) => a - b);
    return days.length ? days.join(", ") : "";
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue === 0) return "";
  return numberValue >= 1 && numberValue <= 31
    ? String(numberValue)
    : formatPublicCurrency(numberValue);
};

const buildPublicTermHighlights = (criteria: Record<string, any>) => {
  const terms: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === "") return;
    terms.push({ label, value: String(value) });
  };

  push("Minimum CIBIL", criteria.cibilScore ? `${criteria.cibilScore}+` : "");
  push("ROI", criteria.roi ? `${formatPublicPercent(criteria.roi)} p.a.` : "");
  push(
    "Maximum Loan",
    criteria.maximumLoanAmount
      ? formatPublicCurrency(criteria.maximumLoanAmount)
      : "",
  );
  push(
    "Tenure",
    criteria.maxTenureYears
      ? `Up to ${formatPublicYears(criteria.maxTenureYears)}`
      : "",
  );
  push(
    "Age",
    criteria.minAge || criteria.maxAge
      ? `${criteria.minAge || 18} - ${criteria.maxAge || 65} years`
      : "",
  );
  push(
    "Processing Fee",
    criteria.processingFees !== null &&
      criteria.processingFees !== undefined &&
      criteria.processingFees !== ""
      ? `${formatPublicAmountByType(criteria.processingFees, criteria.processingFeesType)}${
          normalizeAmountType(criteria.processingFeesType) ===
          EligibilityAmountType.FIXED
            ? ""
            : " of loan amount"
        }`
      : "",
  );
  push("Login Fee", criteria.loginFees);
  push(
    "Insurance",
    criteria.insuranceValue !== null &&
      criteria.insuranceValue !== undefined &&
      criteria.insuranceValue !== ""
      ? formatPublicAmountByType(
          criteria.insuranceValue,
          criteria.insuranceType,
          EligibilityAmountType.FIXED,
        )
      : criteria.insurance,
  );
  push(
    "Property Insurance",
    criteria.propertyInsuranceRequired
      ? `Yes${criteria.propertyInsurancePercentage ? ` (${formatPublicPercent(criteria.propertyInsurancePercentage)})` : ""}`
      : "",
  );
  push(
    "Life Insurance",
    criteria.lifeInsuranceRequired
      ? `Yes${criteria.lifeInsurancePercentage ? ` (${formatPublicPercent(criteria.lifeInsurancePercentage)})` : ""}`
      : "",
  );
  push(
    "Minimum ITR",
    criteria.itrYears ? formatPublicYears(criteria.itrYears) : "",
  );
  push("ABB Days", formatPublicAbb(criteria.abb));
  push(
    "Low LTV",
    criteria.lowLtvMin || criteria.lowLtvMax
      ? `${formatPublicPercent(criteria.lowLtvMin || 0)} - ${formatPublicPercent(criteria.lowLtvMax || 0)}`
      : criteria.lowLtv
        ? formatPublicPercent(criteria.lowLtv)
        : "",
  );
  push("Net Salary", formatPublicCurrency(criteria.netSalary));
  push("Current EMI Limit", formatPublicCurrency(criteria.currentTotalEmi));
  push(
    "Company Category",
    Array.isArray(criteria.companyCategory)
      ? criteria.companyCategory.join(", ")
      : criteria.companyCategory,
  );
  push(
    "Category Basis",
    criteria.companyCategoryBasis
      ? criteria.companyCategoryBasis === "bank"
        ? "Bank Based"
        : "Company Based"
      : "",
  );
  push("Balance Transfer", criteria.businessProgramFresh);
  push(
    "Total Experience",
    criteria.totalExperience ? formatPublicYears(criteria.totalExperience) : "",
  );
  push(
    "Current Experience",
    criteria.currentExperience
      ? formatPublicYears(criteria.currentExperience)
      : "",
  );
  push(
    "Business Vintage",
    criteria.totalVintage ? formatPublicYears(criteria.totalVintage) : "",
  );
  push("GST Amount", formatPublicCurrency(criteria.gstAmount));
  push("Banking Amount", formatPublicCurrency(criteria.bankingAmount));
  push("ITR Amount", formatPublicCurrency(criteria.itrAmount));
  push("Receipts Amount", formatPublicCurrency(criteria.receiptsAmount));
  push("NIP/PD Base", formatPublicCurrency(criteria.nipPdBase));
  push(
    "Salary FOIR",
    [
      criteria.salaryFoir0To25000
        ? `0-25k: ${criteria.salaryFoir0To25000}%`
        : "",
      criteria.salaryFoir25000To50000
        ? `25k-50k: ${criteria.salaryFoir25000To50000}%`
        : "",
      criteria.salaryFoir50000To75000
        ? `50k-75k: ${criteria.salaryFoir50000To75000}%`
        : "",
      criteria.salaryFoir75000Above
        ? `75k+: ${criteria.salaryFoir75000Above}%`
        : "",
    ]
      .filter(Boolean)
      .join(", "),
  );
  push(
    "Business FOIR",
    [
      criteria.businessFoir0To600000
        ? `0-6L: ${criteria.businessFoir0To600000}%`
        : "",
      criteria.businessFoir600000To1000000
        ? `6L-10L: ${criteria.businessFoir600000To1000000}%`
        : "",
      criteria.businessFoir1000000Above
        ? `10L+: ${criteria.businessFoir1000000Above}%`
        : "",
    ]
      .filter(Boolean)
      .join(", "),
  );
  push(
    "ITR FOIR",
    [
      criteria.itrFoir0To600000 ? `0-6L: ${criteria.itrFoir0To600000}%` : "",
      criteria.itrFoir600000To1000000
        ? `6L-10L: ${criteria.itrFoir600000To1000000}%`
        : "",
      criteria.itrFoir1000000Above
        ? `10L+: ${criteria.itrFoir1000000Above}%`
        : "",
    ]
      .filter(Boolean)
      .join(", "),
  );
  push(
    "BT Multiplier",
    [
      criteria.btMultiplier0To1Year
        ? `0-1y: ${criteria.btMultiplier0To1Year}x`
        : "",
      criteria.btMultiplier1To3Years
        ? `1-3y: ${criteria.btMultiplier1To3Years}x`
        : "",
      criteria.btMultiplier3YearsAbove
        ? `3y+: ${criteria.btMultiplier3YearsAbove}x`
        : "",
    ]
      .filter(Boolean)
      .join(", "),
  );
  push("Cash Rental", criteria.cashRental);
  push("Bank Rental", criteria.bankRental);
  push("Mix Rental", criteria.mixRental);
  push(
    "Residential LTV",
    criteria.residentialCatALtv ? `Up to ${criteria.residentialCatALtv}%` : "",
  );
  push(
    "Commercial LTV",
    criteria.commercialCatALtv ? `Up to ${criteria.commercialCatALtv}%` : "",
  );
  return terms;
};

const buildPublicEligibilityResult = (
  criteria: Record<string, any>,
  filters: {
    amount: number | null;
    monthlyIncome: number | null;
    cibilScore: number | null;
    tenureYears: number | null;
    salaryType: string;
    loanType: string;
  },
) => {
  const checks: {
    label: string;
    requirement: string;
    provided: string;
    passed: boolean;
  }[] = [];
  let matchScore = 0;

  const criteriaCibil = toPublicNumber(criteria.cibilScore);
  if (criteriaCibil && filters.cibilScore) {
    const passed = filters.cibilScore >= criteriaCibil;
    checks.push({
      label: "CIBIL",
      requirement: `${criteriaCibil}+`,
      provided: String(filters.cibilScore),
      passed,
    });
    matchScore += passed ? 20 : -15;
  }

  const criteriaAmount = toPublicNumber(criteria.maximumLoanAmount);
  if (criteriaAmount && filters.amount) {
    const passed = filters.amount <= criteriaAmount;
    checks.push({
      label: "Loan amount",
      requirement: `Up to ${formatPublicCurrency(criteriaAmount)}`,
      provided: formatPublicCurrency(filters.amount),
      passed,
    });
    matchScore += passed ? 20 : -12;
  }

  const criteriaTenure = toPublicNumber(criteria.maxTenureYears);
  if (criteriaTenure && filters.tenureYears) {
    const passed = filters.tenureYears <= criteriaTenure;
    checks.push({
      label: "Tenure",
      requirement: `Up to ${formatPublicYears(criteriaTenure)}`,
      provided: formatPublicYears(filters.tenureYears),
      passed,
    });
    matchScore += passed ? 12 : -8;
  }

  const criteriaMonthlyIncome =
    filters.salaryType === "Salaried"
      ? toPublicNumber(criteria.netSalary)
      : null;
  if (criteriaMonthlyIncome && filters.monthlyIncome) {
    const passed = filters.monthlyIncome >= criteriaMonthlyIncome;
    checks.push({
      label: "Monthly income",
      requirement: `${formatPublicCurrency(criteriaMonthlyIncome)}+`,
      provided: formatPublicCurrency(filters.monthlyIncome),
      passed,
    });
    matchScore += passed ? 14 : -12;
  }

  if (filters.salaryType) {
    const passed =
      normalizeEligibilitySalaryType(criteria.salaryType) ===
      filters.salaryType;
    checks.push({
      label: "Income profile",
      requirement: criteria.salaryType || "Any",
      provided: filters.salaryType,
      passed,
    });
    matchScore += passed ? 10 : -10;
  }

  if (filters.loanType && criteria.loanType === filters.loanType) {
    matchScore += 18;
  }

  const eligible =
    checks.length === 0 || checks.every((check) => check.passed === true);

  return {
    _id: String(criteria._id || ""),
    loanType: criteria.loanType,
    bankName: criteria.bankName,
    salaryType: criteria.salaryType,
    cibilScore: criteria.cibilScore,
    roi: criteria.roi,
    processingFees: criteria.processingFees,
    processingFeesType: criteria.processingFeesType,
    loginFees: criteria.loginFees,
    insurance: criteria.insurance,
    insuranceType: criteria.insuranceType,
    insuranceValue: criteria.insuranceValue,
    minAge: criteria.minAge,
    maxAge: criteria.maxAge,
    maxTenureYears: criteria.maxTenureYears,
    maximumLoanAmount: criteria.maximumLoanAmount,
    companyCategory: criteria.companyCategory,
    companyCategoryBasis: criteria.companyCategoryBasis,
    eligible,
    matchScore,
    checks,
    terms: buildPublicTermHighlights(criteria),
  };
};

const fetchDocumentAttachment = async (
  doc: DocumentAttachmentInput,
  index: number,
) => {
  if (!doc?.url) return null;
  const response = await axios.get(doc.url, { responseType: "arraybuffer" });
  const contentType = String(
    response.headers["content-type"] || "",
  ).toLowerCase();
  const extension =
    getExtensionFromContentType(contentType) ||
    getExtensionFromUrl(doc.url) ||
    "bin";
  const label = sanitizeFilename(doc.label || `document_${index + 1}`);
  const source = sanitizeFilename(doc.source || "attachment");
  const filename = `${label}_${source}.${extension}`;

  return {
    filename,
    content: Buffer.from(response.data),
    contentType: contentType || "application/octet-stream",
  };
};

export class EligibilityCriteriaController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizeEligibilityPayload(req.body || {});
      const result = await EligibilityCriteriaService.create(payload);
      if (!result) {
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create eligibility criteria"));
      }
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityCriteriaService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityCriteriaService.getById(
        req.params.id,
        false,
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Eligibility criteria not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async publicSearch(req: Request, res: Response, next: NextFunction) {
    try {
      const rawLoanType = req.query.loanType || req.query.product;
      const loanType = normalizePublicLoanType(rawLoanType);
      const salaryType = normalizeEligibilitySalaryType(req.query.salaryType);
      const amount = toPublicNumber(req.query.amount);
      const monthlyIncome = toPublicNumber(req.query.monthlyIncome);
      const cibilScore = toPublicNumber(req.query.cibilScore);
      const tenureYears = toPublicNumber(req.query.tenureYears);
      const limit = clampPublicLimit(req.query.limit);
      const bank = String(req.query.bank || "").trim();
      const q = String(req.query.q || req.query.search || "").trim();

      const query: Record<string, any> = {
        status: EligibilityCriteriaStatus.ACTIVE,
      };

      if (loanType) query.loanType = loanType;
      if (salaryType) query.salaryType = salaryType;
      if (bank) query.bankName = new RegExp(escapeRegExp(bank), "i");
      if (q) {
        const regex = new RegExp(escapeRegExp(q), "i");
        query.$or = [
          { bankName: regex },
          { loanType: regex },
          { salaryType: regex },
        ];
      }

      const fetchLimit = Math.max(limit * 3, 100);
      const criteriaList = await EligibilityCriteria.find(query)
        .select(PUBLIC_ELIGIBILITY_SELECT_FIELDS)
        .sort({ bankName: 1, roi: 1, cibilScore: 1 })
        .limit(fetchLimit)
        .lean();

      const rankedResults = criteriaList
        .map((criteria) =>
          buildPublicEligibilityResult(criteria, {
            amount,
            monthlyIncome,
            cibilScore,
            tenureYears,
            salaryType,
            loanType,
          }),
        )
        .sort((a, b) => {
          if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
          return Number(a.roi || 999) - Number(b.roi || 999);
        })
        .slice(0, limit);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            filters: {
              loanType,
              salaryType,
              amount,
              monthlyIncome,
              cibilScore,
              tenureYears,
              bank,
              q,
            },
            total: rankedResults.length,
            eligibleCount: rankedResults.filter((result) => result.eligible)
              .length,
            results: rankedResults,
          },
          "Eligibility criteria fetched successfully",
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizeEligibilityPayload(req.body || {});
      const result = await EligibilityCriteriaService.updateById(
        req.params.id,
        payload,
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update eligibility criteria"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EligibilityCriteriaService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete eligibility criteria"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async sendMail(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        criteriaIds = [],
        queryId,
        pdfBase64,
        pdfFileName,
        documentAttachments = [],
        recipientType,
      } = req.body || {};

      console.log("[EligibilityMail] Request received", {
        criteriaIds: Array.isArray(criteriaIds) ? criteriaIds.length : 0,
        queryId,
        recipientType: recipientType || "default",
        pdfAttached: Boolean(pdfBase64),
        documentAttachments: Array.isArray(documentAttachments)
          ? documentAttachments.length
          : 0,
      });

      if (!Array.isArray(criteriaIds) || criteriaIds.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "criteriaIds are required"));
      }

      const criteriaList = await EligibilityCriteria.find({
        _id: { $in: criteriaIds },
      }).lean();

      if (!criteriaList || criteriaList.length === 0) {
        return res
          .status(404)
          .json(new ApiError(404, "No eligibility criteria found"));
      }

      console.log("[EligibilityMail] Criteria resolved", {
        criteriaCount: criteriaList.length,
        queryId,
      });

      let loanQuery: any = null;
      if (queryId) {
        loanQuery = await LoanQuery.findById(queryId)
          .select(
            "firstName lastName email mobile loanType loanAmount employmentType monthlyIncome customerId cibilScore",
          )
          .populate("customerId", "cibilScore")
          .lean();

        if (loanQuery?.customerId?.cibilScore) {
          loanQuery.customerCibilScore = loanQuery.customerId.cibilScore;
        }
      }

      if (recipientType === "rm") {
        if (!queryId) {
          return res
            .status(400)
            .json(new ApiError(400, "queryId is required for RM dispatch"));
        }

        const access = await checkEligibilityMailAccess({
          userId: (req as any)?.user?._id,
          userRole: (req as any)?.user?.role,
          queryType: "loan",
          loanType: loanQuery?.loanType,
        });

        if (!access.allowed) {
          return res
            .status(403)
            .json(
              new ApiError(
                403,
                access.reason ||
                  "You do not have access to send this eligibility email",
              ),
            );
        }
      }

      const normalizedDocuments: DocumentAttachmentInput[] = Array.isArray(
        documentAttachments,
      )
        ? documentAttachments
        : [];
      const uniqueDocuments = Array.from(
        new Map(
          normalizedDocuments
            .filter((doc) => doc?.url)
            .map((doc) => [String(doc.url), doc]),
        ).values(),
      );

      const documentAttachmentResults = await Promise.all(
        uniqueDocuments.map(async (doc, index) => {
          try {
            return await fetchDocumentAttachment(doc, index);
          } catch (error) {
            return { error: true, doc };
          }
        }),
      );

      const documentAttachmentFiles = documentAttachmentResults.filter(
        (item: any) => item && !item.error,
      );
      const documentAttachmentFailures = documentAttachmentResults.filter(
        (item: any) => item && item.error,
      );

      const attachments: any[] = [];
      if (typeof pdfBase64 === "string" && pdfBase64.trim()) {
        const normalizedPdf = pdfBase64.replace(
          /^data:application\/pdf;base64,/,
          "",
        );
        attachments.push({
          filename: pdfFileName || `eligibility-${queryId || "details"}.pdf`,
          content: Buffer.from(normalizedPdf, "base64"),
          contentType: "application/pdf",
        });
      }
      attachments.push(...documentAttachmentFiles);

      console.log("[EligibilityMail] Attachments prepared", {
        pdfAttached: Boolean(pdfBase64),
        attachmentCount: attachments.length,
        documentFailures: documentAttachmentFailures.length,
      });

      const subject = `Eligibility Criteria Match - ${
        loanQuery?.firstName ||
        loanQuery?.lastName ||
        loanQuery?.mobile ||
        "Loan Query"
      }`;
      const html = buildEligibilityMailHtml(
        loanQuery,
        criteriaList,
        recipientType,
      );
      const recipients = getRecipientEmails(criteriaList, recipientType);

      console.log("[EligibilityMail] Recipients resolved", {
        recipientType: recipientType || "default",
        recipients,
      });

      if (recipients.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No recipient emails found"));
      }

      if (recipientType === "rm") {
        console.log("[EligibilityMail] Queueing RM dispatch", {
          recipients: recipients.length,
          criteriaCount: criteriaList.length,
        });
        void queueEligibilityMailDispatch({
          recipients,
          subject,
          html,
          attachments,
        }).catch((error: any) => {
          console.log("Eligibility mail queue failed:", error);
        });

        return res.status(202).json(
          new ApiResponse(
            202,
            {
              total: criteriaList.length,
              queued: recipients.length,
              recipientType,
              attachments: {
                total: attachments.length,
                pdfAttached: Boolean(pdfBase64),
                documentFailures: documentAttachmentFailures.length,
              },
            },
            "Email dispatch queued",
          ),
        );
      }

      const results = await Promise.all(
        criteriaList.map(async (criteria: any) => {
          const criteriaRecipients = getRecipientEmails([criteria]);

          if (criteriaRecipients.length === 0) {
            console.log(
              "[EligibilityMail] Skipping criteria with no recipients",
              {
                criteriaId: criteria._id,
                bankName: criteria.bankName,
              },
            );
            return {
              id: criteria._id,
              sent: false,
              reason: "No recipient emails",
            };
          }

          const criteriaHtml = buildEligibilityMailHtml(
            loanQuery,
            [criteria],
            recipientType,
          );

          console.log("[EligibilityMail] Sending criteria mail", {
            criteriaId: criteria._id,
            bankName: criteria.bankName,
            recipients: criteriaRecipients,
          });

          await sendMail(
            createMailOptions(
              criteriaRecipients.join(","),
              subject,
              criteriaHtml,
              attachments,
            ),
          );

          console.log("[EligibilityMail] Criteria mail sent", {
            criteriaId: criteria._id,
            recipients: criteriaRecipients,
          });

          return {
            id: criteria._id,
            sent: true,
            recipients: criteriaRecipients,
          };
        }),
      );

      console.log("[EligibilityMail] Dispatch completed", {
        total: criteriaList.length,
        sent: results.filter((r) => r.sent).length,
        failed: results.filter((r) => !r.sent).length,
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            total: criteriaList.length,
            sent: results.filter((r) => r.sent).length,
            failed: results.filter((r) => !r.sent).length,
            results,
            attachments: {
              total: attachments.length,
              pdfAttached: Boolean(pdfBase64),
              documentFailures: documentAttachmentFailures.length,
            },
          },
          "Email dispatch completed",
        ),
      );
    } catch (err) {
      next(err);
    }
  }
}
