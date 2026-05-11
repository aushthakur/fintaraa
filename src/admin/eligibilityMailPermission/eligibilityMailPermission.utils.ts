import { LoanType } from "../../modals/loanquery.model";
import { InsuranceType } from "../../modals/insurancequery.model";
import { EligibilityMailPermission } from "../../modals/eligibilityMailPermission.model";

type QueryType = "loan" | "insurance";

const normalizeToken = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase();

export const normalizeEnumArray = (
  input: any,
  allowedValues: string[],
): string[] => {
  const allowed = new Set(allowedValues.map(normalizeToken));
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  return Array.from(
    new Set(
      values
        .map((item) => normalizeToken(item))
        .filter((item) => allowed.has(item)),
    ),
  );
};

export const getEligibilityMailPermissionOptions = () => ({
  loanTypes: Object.values(LoanType),
  insuranceTypes: Object.values(InsuranceType),
});

export const checkEligibilityMailAccess = async ({
  userId,
  userRole,
  queryType,
  loanType,
  insuranceType,
}: {
  userId?: string;
  userRole?: string;
  queryType: QueryType;
  loanType?: string;
  insuranceType?: string;
}) => {
  if (userRole === "admin") {
    return {
      allowed: true,
      isAdmin: true,
      matchedBy: "admin_override",
      rule: null,
      reason: "",
    };
  }

  if (!userId) {
    return {
      allowed: false,
      isAdmin: false,
      matchedBy: null,
      rule: null,
      reason: "User not found",
    };
  }

  const rule = await EligibilityMailPermission.findOne({
    agent: userId,
    status: true,
  }).lean();

  if (!rule) {
    return {
      allowed: false,
      isAdmin: false,
      matchedBy: null,
      rule: null,
      reason: "No eligibility email permission assigned",
    };
  }

  if (queryType === "loan") {
    const normalizedLoanType = normalizeToken(loanType);
    const allowedLoanTypes = Array.isArray(rule.loanTypes)
      ? rule.loanTypes.map(normalizeToken)
      : [];
    const allowed =
      Boolean(rule.allowAllLoanTypes) ||
      (Boolean(normalizedLoanType) &&
        allowedLoanTypes.includes(normalizedLoanType));

    return {
      allowed,
      isAdmin: false,
      matchedBy: rule.allowAllLoanTypes ? "all_loan_types" : "loan_type",
      rule,
      reason: allowed
        ? ""
        : "This loan type is not enabled for your eligibility email access",
    };
  }

  const normalizedInsuranceType = normalizeToken(insuranceType);
  const allowedInsuranceTypes = Array.isArray(rule.insuranceTypes)
    ? rule.insuranceTypes.map(normalizeToken)
    : [];
  const allowed =
    Boolean(rule.allowAllInsuranceTypes) ||
    (Boolean(normalizedInsuranceType) &&
      allowedInsuranceTypes.includes(normalizedInsuranceType));

  return {
    allowed,
    isAdmin: false,
    matchedBy: rule.allowAllInsuranceTypes
      ? "all_insurance_types"
      : "insurance_type",
    rule,
    reason: allowed
      ? ""
      : "This insurance type is not enabled for your eligibility email access",
  };
};
