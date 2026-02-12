import { LoanType } from "../modals/loanquery.model";

const LOAN_TYPE_SET = new Set(Object.values(LoanType));

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
  return undefined;
};
