import { LoanType } from "../modals/loanquery.model";

const LOAN_TYPE_SET = new Set(Object.values(LoanType));
const LOAN_TYPE_ALIAS_MAP: Record<string, LoanType> = {
  two_wheeler_loan: LoanType.VEHICLE_LOAN,
  used_car_loan: LoanType.VEHICLE_LOAN,
  agriculture_loan: LoanType.BUSINESS_LOAN,
  top_up_loan: LoanType.PERSONAL_LOAN,
  balance_transfer_loan: LoanType.PERSONAL_LOAN,
  loan_against_car_value: LoanType.LOAN_AGAINST_CAR,
  construction_loan: LoanType.HOME_LOAN,
  dod: LoanType.DOD_LOAN,
  dod_loan: LoanType.DOD_LOAN,
  od: LoanType.OD_LOAN,
  od_loan: LoanType.OD_LOAN,
  industrial: LoanType.INDUSTRIAL_LOAN,
  industrial_loan: LoanType.INDUSTRIAL_LOAN,
  commercial_purchases: LoanType.COMMERCIAL_PURCHASES_LOAN,
  commercial_purchase_loan: LoanType.COMMERCIAL_PURCHASES_LOAN,
  commercial_purchases_loan: LoanType.COMMERCIAL_PURCHASES_LOAN,
  card: LoanType.CREDIT_CARD,
  card_loan: LoanType.CREDIT_CARD,
  credit_card_loan: LoanType.CREDIT_CARD,
};

const normalizeInput = (value: string) => {
  const withUnderscores = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return withUnderscores
    .replace(/[\s-]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase()
    .trim();
};

export const normalizeLoanType = (value?: string) => {
  if (!value) return undefined;
  const raw = value.toString().trim();
  if (!raw) return undefined;
  const normalized = normalizeInput(raw);
  if (LOAN_TYPE_SET.has(normalized as LoanType)) return normalized;
  return LOAN_TYPE_ALIAS_MAP[normalized];
};

export const getLoanTypeMatchValues = (value?: string) => {
  const resolvedLoanType = normalizeLoanType(value);
  if (!resolvedLoanType) return [];

  const matchValues = new Set<string>([resolvedLoanType]);
  Object.entries(LOAN_TYPE_ALIAS_MAP).forEach(([alias, canonical]) => {
    if (canonical === resolvedLoanType) {
      matchValues.add(alias);
    }
  });

  return Array.from(matchValues);
};
