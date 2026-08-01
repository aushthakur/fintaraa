import ApiError from "../utils/ApiError";
import { agencyPayoutProfileService } from "./agencyPayoutProfile.service";

type BankDetails = Record<string, any>;

type PublicPayoutProfile = {
  method?: string;
  maskedDestination?: string;
  accountHolder?: string;
  ifsc?: string;
  bankName?: string;
} | null;

const compactAccount = (value: unknown) =>
  String(value || "").replace(/\s+/g, "");

const normalizedIfsc = (value: unknown) =>
  String(value || "").trim().toUpperCase();

const normalizedHolder = (value: unknown) =>
  String(value || "").trim();

const hasOwn = (value: unknown, key: string) =>
  Boolean(
    value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, key),
  );

const suppliedField = (input: BankDetails, keys: string[]) => {
  const key = keys.find((candidate) => hasOwn(input, candidate));
  return key
    ? { supplied: true, value: input[key] }
    : { supplied: false, value: undefined };
};

export const getMaskedBankAccountSuffix = (value: unknown) => {
  const match = compactAccount(value).match(/^[•*xX]{2,}(\d{1,4})$/);
  return match?.[1] || null;
};

export const isMaskedBankAccount = (value: unknown) =>
  Boolean(getMaskedBankAccountSuffix(value));

const isRawBankAccount = (value: unknown) =>
  /^\d{6,20}$/.test(compactAccount(value));

const maskBankAccount = (value: unknown) => {
  const compact = compactAccount(value);
  const suffix = getMaskedBankAccountSuffix(compact) || compact.slice(-4);
  return suffix ? `••••${suffix}` : undefined;
};

const sameHolder = (left: unknown, right: unknown) =>
  normalizedHolder(left).toLocaleLowerCase("en-IN") ===
  normalizedHolder(right).toLocaleLowerCase("en-IN");

export type AgencyBankUpdatePlan = {
  maskedAccount?: string;
  rawAccountForEncryption?: string;
  nextIfsc: string;
  nextAccountHolder: string;
  accountIdentityChanged: boolean;
  legacyMigration: boolean;
};

export const resolveAgencyBankUpdatePlan = (input: {
  submitted: BankDetails;
  existing?: BankDetails;
  payoutProfile?: PublicPayoutProfile;
}): AgencyBankUpdatePlan => {
  const submitted = input.submitted || {};
  const existing = input.existing || {};
  const payoutProfile = input.payoutProfile || null;
  const existingAccount = compactAccount(existing.accountNumber);
  const existingRawAccount = isRawBankAccount(existingAccount)
    ? existingAccount
    : undefined;
  const profileIsBank = payoutProfile?.method === "bank_transfer";
  const profileMask = profileIsBank
    ? maskBankAccount(payoutProfile?.maskedDestination)
    : undefined;
  const existingMask = maskBankAccount(existingAccount);
  const baselineMask = existingMask || profileMask;
  const baselineSuffix = getMaskedBankAccountSuffix(baselineMask);

  const ifscInput = suppliedField(submitted, ["ifscCode", "ifsc"]);
  const holderInput = suppliedField(submitted, [
    "accountHolderName",
    "accountHolder",
  ]);
  const existingIfsc = normalizedIfsc(
    existing.ifscCode || existing.ifsc || (profileIsBank ? payoutProfile?.ifsc : ""),
  );
  const existingHolder = normalizedHolder(
    existing.accountHolderName ||
      existing.accountHolder ||
      (profileIsBank ? payoutProfile?.accountHolder : ""),
  );
  const nextIfsc = ifscInput.supplied
    ? normalizedIfsc(ifscInput.value)
    : existingIfsc;
  const nextAccountHolder = holderInput.supplied
    ? normalizedHolder(holderInput.value)
    : existingHolder;
  const sensitiveIdentityChanged =
    (ifscInput.supplied && nextIfsc !== existingIfsc) ||
    (holderInput.supplied && !sameHolder(nextAccountHolder, existingHolder));

  const accountInput = suppliedField(submitted, ["accountNumber"]);
  const submittedAccount = compactAccount(accountInput.value);
  const submittedMaskSuffix = getMaskedBankAccountSuffix(submittedAccount);
  const submittedRawAccount = isRawBankAccount(submittedAccount)
    ? submittedAccount
    : undefined;

  if (accountInput.supplied && submittedAccount && !submittedMaskSuffix && !submittedRawAccount) {
    throw new ApiError(
      400,
      "Enter a valid account number or keep the unchanged masked account",
    );
  }

  if (submittedMaskSuffix) {
    if (!baselineSuffix || submittedMaskSuffix !== baselineSuffix) {
      throw new ApiError(
        400,
        "Masked account does not match the saved account. Enter the full account number",
      );
    }
    if (sensitiveIdentityChanged) {
      throw new ApiError(
        400,
        "Enter the full account number when changing account holder or IFSC",
      );
    }
  }

  if (!submittedRawAccount && sensitiveIdentityChanged) {
    throw new ApiError(
      400,
      "Enter the full account number when changing account holder or IFSC",
    );
  }

  const rawAccount = submittedRawAccount || existingRawAccount;
  const rawSuffix = rawAccount?.slice(-4);
  const encryptedProfileMatchesRaw = Boolean(
    rawAccount &&
      profileIsBank &&
      getMaskedBankAccountSuffix(profileMask) === rawSuffix &&
      normalizedIfsc(payoutProfile?.ifsc) === nextIfsc &&
      sameHolder(payoutProfile?.accountHolder, nextAccountHolder),
  );
  const mustEncryptRaw = Boolean(
    submittedRawAccount || (existingRawAccount && !encryptedProfileMatchesRaw),
  );
  if (mustEncryptRaw && (!nextIfsc || !nextAccountHolder)) {
    throw new ApiError(
      400,
      "Account holder and IFSC are required to secure bank details",
    );
  }

  const nextMask = submittedRawAccount
    ? maskBankAccount(submittedRawAccount)
    : profileMask && getMaskedBankAccountSuffix(profileMask) === baselineSuffix
      ? profileMask
      : baselineMask;
  const nextSuffix = getMaskedBankAccountSuffix(nextMask);

  return {
    maskedAccount: nextMask,
    rawAccountForEncryption: mustEncryptRaw ? rawAccount : undefined,
    nextIfsc,
    nextAccountHolder,
    accountIdentityChanged:
      sensitiveIdentityChanged ||
      // The encrypted value is intentionally not exposed for comparison. A
      // freshly submitted full account must therefore be treated as a
      // verification-affecting change even when its last four digits match.
      Boolean(submittedRawAccount),
    legacyMigration: Boolean(
      existingRawAccount && !submittedRawAccount && mustEncryptRaw,
    ),
  };
};

const comparable = (value: unknown) => String(value || "").trim();

export const applyEncryptedAgencyBankDetails = async (
  agency: any,
  input: BankDetails,
) => {
  if (!input || typeof input !== "object" || !Object.keys(input).length) {
    return { changed: false, accountIdentityChanged: false };
  }
  const existing = agency.bankDetails?.toObject
    ? agency.bankDetails.toObject()
    : agency.bankDetails || {};
  const payoutProfile: any = await agencyPayoutProfileService.get(
    String(agency._id),
  );
  const plan = resolveAgencyBankUpdatePlan({
    submitted: input,
    existing,
    payoutProfile,
  });
  let maskedAccount = plan.maskedAccount;
  if (plan.rawAccountForEncryption) {
    const encryptedProfile: any = await agencyPayoutProfileService.upsert({
      agencyId: String(agency._id),
      updatedBy: String(agency._id),
      method: "bank_transfer",
      accountNumber: plan.rawAccountForEncryption,
      ifsc: plan.nextIfsc,
      accountHolder: plan.nextAccountHolder,
      bankName: String(input.bankName || existing.bankName || "").trim(),
    });
    maskedAccount = encryptedProfile?.maskedDestination || maskedAccount;
  }

  const next = {
    ...existing,
    bankName: String(input.bankName || existing.bankName || "").trim(),
    branchName: String(input.branchName || existing.branchName || "").trim(),
    branchCity: String(input.branchCity || existing.branchCity || "").trim(),
    accountType: String(input.accountType || existing.accountType || "").trim(),
    accountNumber: maskedAccount || existing.accountNumber,
    accountHolderName: plan.nextAccountHolder || existing.accountHolderName,
    ifscCode: plan.nextIfsc || existing.ifscCode,
    cancelledChequeUrl:
      String(input.cancelledChequeUrl || "").trim() || existing.cancelledChequeUrl,
  };
  const chequeChanged =
    hasOwn(input, "cancelledChequeUrl") &&
    comparable(next.cancelledChequeUrl) !== comparable(existing.cancelledChequeUrl);
  const verificationChanged = plan.accountIdentityChanged || chequeChanged;
  if (verificationChanged) {
    Object.assign(next, {
      verified: false,
      verificationStatus: "pending",
      verificationMessage: undefined,
      verificationReferenceId: undefined,
      verificationUtr: undefined,
      verifiedAt: undefined,
    });
  }
  const changed = [
    "bankName",
    "branchName",
    "branchCity",
    "accountType",
    "accountNumber",
    "accountHolderName",
    "ifscCode",
    "cancelledChequeUrl",
  ].some((key) => comparable(next[key]) !== comparable(existing[key]));
  agency.bankDetails = next;
  return { changed, accountIdentityChanged: plan.accountIdentityChanged };
};
