import { LoanType } from "../modals/loanquery.model";

const normalizeInput = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

/**
 * Accepted historical and client-facing spellings for each persisted loan
 * type. Some persisted values intentionally retain the legacy API contract
 * (for example `Vechile Loan`), while snake_case and camelCase inputs remain
 * accepted without a data migration.
 */
const LOAN_TYPE_VARIANTS: Partial<Record<LoanType, readonly string[]>> = {
  [LoanType.PERSONAL_LOAN]: ["Personal Loan", "personalLoan"],
  [LoanType.TOP_UP_LOAN]: [
    "Top-up Loan",
    "Top Up Loan",
    "topup_loan",
    "topUpLoan",
    "topup",
  ],
  [LoanType.BALANCE_TRANSFER_TOP_UP_LOAN]: [
    "Balance Transfer Loan",
    "Balance Transfer Loan + Top up Loan",
    "Balance Transfer + Top Up Loan",
    "Balance Transfer + Top-up Loan",
    "Balance Transfer+ Top-up Loan",
    "balance_transfer_loan",
    "balance_transfer_loan_top_up_loan",
    "balance_transfer_top_up_loan",
    "balance_transfer_plus_top_up_loan",
    "balanceTransferLoan",
    "balanceTransferLoanTopUpLoan",
    "balanceTransferTopUpLoan",
    "balanceTransferPlusTopUpLoan",
  ],
  [LoanType.BUSINESS_LOAN]: ["Business Loan", "businessLoan"],
  [LoanType.AGRICULTURE_LOAN]: ["agriculture_loan", "agricultureLoan"],
  [LoanType.SOLAR_LOAN]: ["solar_loan", "solarLoan"],
  [LoanType.CAR_LOAN]: [
    "Car Loan",
    "car_loan",
    "carLoan",
    "Vehicle Loan",
    "vehicleLoan",
  ],
  [LoanType.TWO_WHEELER_LOAN]: [
    "two_wheeler_loan",
    "twoWheelerLoan",
    "Two-Wheeler Loan",
  ],
  [LoanType.VEHICLE_LOAN]: [
    "Used Car Loan",
    "used_car_loan",
    "usedCarLoan",
  ],
  [LoanType.HOME_LOAN]: [
    "Home Loan",
    "homeLoan",
    "Construction Loan",
    "construction_loan",
    "constructionLoan",
  ],
  [LoanType.INSTANT_LOAN]: ["Instant Loan", "instantLoan"],
  [LoanType.EDUCATION_LOAN]: ["Education Loan", "educationLoan"],
  [LoanType.GOLD_LOAN]: ["Gold Loan", "goldLoan"],
  [LoanType.LOAN_AGAINST_PROPERTY]: [
    "Loan Against Property",
    "loanAgainstProperty",
    "lap",
  ],
  [LoanType.RENOVATION_LOAN]: ["Renovation Loan", "renovationLoan"],
  [LoanType.WORKING_CAPITAL_LOAN]: [
    "Working Capital Loan",
    "workingCapitalLoan",
  ],
  [LoanType.LOAN_AGAINST_SECURITY]: [
    "Loan Against Security",
    "loanAgainstSecurity",
    "las",
  ],
  [LoanType.LOAN_AGAINST_CAR]: [
    "Loan Against Car",
    "Loan Against Car Value",
    "loan_against_car_value",
    "loanAgainstCar",
    "loanAgainstCarValue",
  ],
  [LoanType.MACHINERY_LOAN]: ["Machinery Loan", "machineryLoan"],
  [LoanType.DOD_LOAN]: ["DOD", "DOD Loan", "dod"],
  [LoanType.OD_LOAN]: ["OD", "OD Loan", "od"],
  [LoanType.INDUSTRIAL_LOAN]: ["Industrial Loan", "industrial"],
  [LoanType.COMMERCIAL_PURCHASES_LOAN]: [
    "Commercial Purchases Loan",
    "Commercial Purchase Loan",
    "commercial_purchases",
    "commercial_purchase_loan",
    "commercialPurchasesLoan",
  ],
  [LoanType.CREDIT_CARD]: [
    "Credit Card",
    "creditCard",
    "card",
    "card_loan",
    "credit_card_loan",
  ],
};

const LOAN_TYPE_BY_NORMALIZED_KEY = new Map<string, LoanType>();

// `vehicleLoan` was the historical Car Loan flow key, while the explicit
// snake_case `vehicle_loan` contract now belongs to Used Car Loan. Preserve
// that distinction before normalized-token lookup collapses both spellings.
const EXACT_LOAN_TYPE_ALIASES = new Map<string, LoanType>([
  ["vehicleLoan", LoanType.CAR_LOAN],
  ["Vehicle Loan", LoanType.CAR_LOAN],
  ["vehicleloan", LoanType.CAR_LOAN],
  ["vehicle loan", LoanType.CAR_LOAN],
]);

const LOAN_TYPE_DISPLAY_LABELS: Record<LoanType, string> = {
  [LoanType.PERSONAL_LOAN]: "Personal Loan",
  [LoanType.TOP_UP_LOAN]: "Top-up Loan",
  [LoanType.BALANCE_TRANSFER_TOP_UP_LOAN]:
    "Balance Transfer Loan + Top up Loan",
  [LoanType.EDUCATION_LOAN]: "Education Loan",
  [LoanType.CAR_LOAN]: "Car Loan",
  [LoanType.TWO_WHEELER_LOAN]: "Two Wheeler Loan",
  [LoanType.VEHICLE_LOAN]: "Used Car Loan",
  [LoanType.GOLD_LOAN]: "Gold Loan",
  [LoanType.LOAN_AGAINST_CAR]: "Loan Against Car",
  [LoanType.INSTANT_LOAN]: "Instant Loan",
  [LoanType.LOAN_AGAINST_PROPERTY]: "Loan Against Property",
  [LoanType.RENOVATION_LOAN]: "Renovation Loan",
  [LoanType.WORKING_CAPITAL_LOAN]: "Working Capital Loan",
  [LoanType.LOAN_AGAINST_SECURITY]: "Loan Against Security",
  [LoanType.MACHINERY_LOAN]: "Machinery Loan",
  [LoanType.HOME_LOAN]: "Home Loan",
  [LoanType.BUSINESS_LOAN]: "Business Loan",
  [LoanType.AGRICULTURE_LOAN]: "Agriculture Loan",
  [LoanType.SOLAR_LOAN]: "Solar Loan",
  [LoanType.DOD_LOAN]: "DOD Loan",
  [LoanType.OD_LOAN]: "OD Loan",
  [LoanType.INDUSTRIAL_LOAN]: "Industrial Loan",
  [LoanType.COMMERCIAL_PURCHASES_LOAN]: "Commercial Purchases Loan",
  [LoanType.CREDIT_CARD]: "Credit Card",
};

Object.entries(LOAN_TYPE_VARIANTS).forEach(([canonical, variants]) => {
  (variants || []).forEach((variant) => {
    LOAN_TYPE_BY_NORMALIZED_KEY.set(
      normalizeInput(variant),
      canonical as LoanType,
    );
  });
});

// Canonical enum values win if a future alias happens to normalize to the
// same token. This also makes mixed-case enum values resolvable after input
// normalization (a Set of raw enum values cannot do that).
Object.values(LoanType).forEach((canonical) => {
  LOAN_TYPE_BY_NORMALIZED_KEY.set(normalizeInput(canonical), canonical);
});

export const normalizeLoanType = (value?: string): LoanType | undefined => {
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const exactAlias =
    EXACT_LOAN_TYPE_ALIASES.get(raw) ||
    EXACT_LOAN_TYPE_ALIASES.get(raw.toLowerCase());
  if (exactAlias) return exactAlias;
  return LOAN_TYPE_BY_NORMALIZED_KEY.get(normalizeInput(raw));
};

/**
 * Values used when reading historical data. New writes use the resolved enum
 * value, while filters also include old snake_case/camelCase/display values.
 */
export const getLoanTypeMatchValues = (value?: string): string[] => {
  const resolvedLoanType = normalizeLoanType(value);
  if (!resolvedLoanType) return [];

  const matchValues = new Set<string>([
    resolvedLoanType,
    normalizeInput(resolvedLoanType),
  ]);
  (LOAN_TYPE_VARIANTS[resolvedLoanType] || []).forEach((variant) => {
    matchValues.add(variant);
  });

  const raw = String(value || "").trim();
  if (raw) matchValues.add(raw);
  return Array.from(matchValues);
};

export const getLoanTypeDisplayLabel = (
  value?: string,
  policyDetails?: Record<string, any> | null,
): string => {
  const loanType = normalizeLoanType(value);
  if (loanType === LoanType.HOME_LOAN) {
    const variantValues = [
      policyDetails?.productVariant,
      policyDetails?.metaFlowKey,
      policyDetails?.requestedProductName,
      policyDetails?.productLabel,
    ];
    if (
      variantValues.some((variant) =>
        normalizeInput(String(variant || "")).includes("construction"),
      )
    ) {
      return "Construction Loan";
    }
  }
  if (loanType) return LOAN_TYPE_DISPLAY_LABELS[loanType];

  const raw = String(value || "Loan").trim() || "Loan";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
};
