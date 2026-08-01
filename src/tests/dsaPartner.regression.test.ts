import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config/config";
import {
  PartnerCredential,
  PartnerCredentialAuthType,
} from "../modals/partnerCredential.model";
import { normalizeDsaMobile } from "../services/dsaMobileChange.service";
import { calculateDsaCommission } from "../services/agencyEarnings.service";
import {
  decryptPartnerCredentials,
  encryptPartnerCredentials,
  validatePartnerCredentialPayload,
} from "../services/partnerCredential.service";
import { normalizeComparablePartnerProductType } from "../services/partnerMatching.service";
import {
  buildPartnerProductUpdateOperation,
  isPartnerAssignmentTransitionAllowed,
} from "../admin/partner/partner.controller";
import { PartnerAssignmentStatus } from "../modals/partnerAssignment.model";
import {
  MINIMUM_DSA_PAYOUT_AMOUNT,
  validateDsaPayoutAmount,
} from "../services/agencyPayout.service";
import {
  isMaskedBankAccount,
  resolveAgencyBankUpdatePlan,
} from "../services/agencyBankDetails.service";

test("DSA mobile change normalizes Indian and international numbers", () => {
  assert.equal(normalizeDsaMobile("+91 98765-43210"), "919876543210");
  assert.equal(normalizeDsaMobile("9876543210"), "9876543210");
  assert.throws(() => normalizeDsaMobile("12345"), /valid mobile/i);
});

test("DSA commission rules calculate flat, percentage, ranges and caps", () => {
  assert.equal(
    calculateDsaCommission({ calculationType: "flat", value: 2500 }, 500000),
    2500,
  );
  assert.equal(
    calculateDsaCommission(
      { calculationType: "percentage", value: 1.25 },
      400000,
    ),
    5000,
  );
  assert.equal(
    calculateDsaCommission(
      { calculationType: "percentage", value: 2, capAmount: 3000 },
      400000,
    ),
    3000,
  );
  assert.equal(
    calculateDsaCommission(
      { calculationType: "flat", value: 2500, minLoanAmount: 500000 },
      499999,
    ),
    0,
  );
});

test("partner product types normalize legacy display variants consistently", () => {
  assert.equal(
    normalizeComparablePartnerProductType("Home Loan"),
    normalizeComparablePartnerProductType("home_loan"),
  );
  assert.equal(
    normalizeComparablePartnerProductType("Self-employed & Business"),
    "selfemployedandbusiness",
  );
});

test("partner credential validation enforces auth-specific required keys", () => {
  assert.deepEqual(
    validatePartnerCredentialPayload(PartnerCredentialAuthType.API_KEY, {
      apiKey: "secret",
    }).credentialKeys,
    ["apiKey"],
  );
  assert.throws(
    () =>
      validatePartnerCredentialPayload(PartnerCredentialAuthType.BASIC, {
        username: "partner",
      }),
    /username and password/i,
  );
  assert.throws(
    () =>
      validatePartnerCredentialPayload(
        PartnerCredentialAuthType.CUSTOM,
        JSON.parse('{"__proto__":{"polluted":true}}'),
      ),
    /not allowed/i,
  );
});

test("partner credentials encrypt at rest and round-trip only inside the service", () => {
  const originalKey = config.partnerCredentials.encryptionKey;
  config.partnerCredentials.encryptionKey = "12345678901234567890123456789012";
  try {
    const secret = { apiKey: "never-return-this-value", nested: { token: "abc" } };
    const encrypted = encryptPartnerCredentials(secret);
    assert.equal(JSON.stringify(encrypted).includes(secret.apiKey), false);
    assert.deepEqual(decryptPartnerCredentials(encrypted), secret);
  } finally {
    config.partnerCredentials.encryptionKey = originalKey;
  }
});

test("partner credential model serialization never exposes encrypted payload", () => {
  const credential = new PartnerCredential({
    partner: "64b000000000000000000001",
    provider: "test",
    authType: PartnerCredentialAuthType.API_KEY,
    credentialKeys: ["apiKey"],
    encryptedCredentials: {
      version: 1,
      iv: "iv",
      authTag: "tag",
      ciphertext: "ciphertext",
    },
  });
  assert.equal("encryptedCredentials" in credential.toJSON(), false);
  assert.equal("encryptedCredentials" in credential.toObject(), false);
});

test("partner product updates explicitly unset cleared optional values", () => {
  assert.deepEqual(
    buildPartnerProductUpdateOperation(
      {
        interestRateMin: null,
        eligibility: { cibilMin: "", incomeMax: 100000 },
        insurance: { coverageMax: null },
      },
      {
        interestRateMin: undefined,
        eligibility: { cibilMin: undefined, incomeMax: 100000 },
        insurance: { coverageMax: undefined },
      },
    ),
    {
      $set: { "eligibility.incomeMax": 100000 },
      $unset: {
        interestRateMin: "",
        "eligibility.cibilMin": "",
        "insurance.coverageMax": "",
      },
    },
  );
});

test("partner assignment lifecycle permits forward progress and closes terminal cases", () => {
  assert.equal(
    isPartnerAssignmentTransitionAllowed(
      PartnerAssignmentStatus.ASSIGNED,
      PartnerAssignmentStatus.APPROVED,
    ),
    true,
  );
  assert.equal(
    isPartnerAssignmentTransitionAllowed(
      PartnerAssignmentStatus.APPROVED,
      PartnerAssignmentStatus.DISBURSED,
    ),
    true,
  );
  assert.equal(
    isPartnerAssignmentTransitionAllowed(
      PartnerAssignmentStatus.DISBURSED,
      PartnerAssignmentStatus.ASSIGNED,
    ),
    false,
  );
  assert.equal(
    isPartnerAssignmentTransitionAllowed(
      PartnerAssignmentStatus.REJECTED,
      PartnerAssignmentStatus.SENT,
    ),
    false,
  );
});

test("DSA payout amount enforces paise precision and available balance", () => {
  assert.equal(validateDsaPayoutAmount(500, 500), 500);
  assert.equal(validateDsaPayoutAmount("500.25", 600), 500.25);
  assert.throws(
    () => validateDsaPayoutAmount(MINIMUM_DSA_PAYOUT_AMOUNT / 10, 100),
    /valid payout amount/i,
  );
  assert.throws(
    () => validateDsaPayoutAmount(10.001, 100),
    /two decimal/i,
  );
  assert.throws(
    () => validateDsaPayoutAmount(100.01, 100),
    /insufficient available balance/i,
  );
});

test("unchanged masked bank details preserve the encrypted destination", () => {
  const plan = resolveAgencyBankUpdatePlan({
    submitted: {
      accountNumber: "••••4321",
      accountHolderName: "Rishabh Gupta",
      ifscCode: "HDFC0001234",
    },
    existing: {
      accountNumber: "••••4321",
      accountHolderName: "Rishabh Gupta",
      ifscCode: "HDFC0001234",
    },
    payoutProfile: {
      method: "bank_transfer",
      maskedDestination: "••••4321",
      accountHolder: "Rishabh Gupta",
      ifsc: "HDFC0001234",
    },
  });
  assert.equal(isMaskedBankAccount("****4321"), true);
  assert.equal(plan.maskedAccount, "••••4321");
  assert.equal(plan.rawAccountForEncryption, undefined);
  assert.equal(plan.accountIdentityChanged, false);
});

test("masked bank details require the full account for holder or IFSC changes", () => {
  const base = {
    existing: {
      accountNumber: "••••4321",
      accountHolderName: "Rishabh Gupta",
      ifscCode: "HDFC0001234",
    },
    payoutProfile: {
      method: "bank_transfer",
      maskedDestination: "••••4321",
      accountHolder: "Rishabh Gupta",
      ifsc: "HDFC0001234",
    },
  };
  assert.throws(
    () =>
      resolveAgencyBankUpdatePlan({
        ...base,
        submitted: {
          accountNumber: "••••4321",
          ifscCode: "ICIC0009876",
        },
      }),
    /full account number/i,
  );
  assert.throws(
    () =>
      resolveAgencyBankUpdatePlan({
        ...base,
        submitted: { accountNumber: "••••9999" },
      }),
    /does not match/i,
  );
});

test("legacy raw bank details are encrypted before their stored value is masked", () => {
  const plan = resolveAgencyBankUpdatePlan({
    submitted: { accountNumber: "••••4321" },
    existing: {
      accountNumber: "12345678904321",
      accountHolderName: "Rishabh Gupta",
      ifscCode: "HDFC0001234",
    },
    payoutProfile: null,
  });
  assert.equal(plan.rawAccountForEncryption, "12345678904321");
  assert.equal(plan.maskedAccount, "••••4321");
  assert.equal(plan.legacyMigration, true);
  assert.equal(plan.accountIdentityChanged, false);
});
