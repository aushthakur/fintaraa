import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { ApplicationStatus } from "../modals/insurancequery.model";
import { ReferralEvent } from "../modals/referralEvent.model";
import { ReferralProgramConfig } from "../modals/referralProgramConfig.model";
import { ReferralPayoutRequest } from "../modals/referralPayoutRequest.model";
import { User } from "../modals/user.model";
import {
  creditReferralRewardOnDisbursal,
  getEligibleReferralDisbursedAmount,
} from "../services/referral.service";
import * as notificationService from "../services/notification.service";
import {
  calculateReferralWalletBalances,
  MAXIMUM_REFERRAL_PAYOUT_AMOUNT,
  MINIMUM_REFERRAL_PAYOUT_AMOUNT,
  ReferralWalletService,
  referralWalletService,
  validateReferralPayoutAmount,
} from "../services/referralWallet.service";
import { AdminReferralController } from "../admin/referral/referral.controller";
import {
  buildUserReferralCode,
  getReferralAttributionDecision,
  isReferralCodeDuplicateError,
  normalizeReferralCode,
} from "../utils/referral";

test("reward eligibility requires an explicit disbursed status and amount", () => {
  assert.equal(
    getEligibleReferralDisbursedAmount(
      {
        status: ApplicationStatus.DISBURSED,
        disbursedAmount: 100_000,
        loanAmount: 500_000,
      },
      50_000,
    ),
    100_000,
  );
  assert.equal(
    getEligibleReferralDisbursedAmount(
      {
        status: ApplicationStatus.DISBURSED_PARTIAL_FULL,
        disbursedAmount: "75000",
      },
      75_000,
    ),
    75_000,
  );
  assert.equal(
    getEligibleReferralDisbursedAmount(
      {
        status: ApplicationStatus.COMPLETED_SUCCESS,
        disbursedAmount: 100_000,
      },
      0,
    ),
    null,
  );
  assert.equal(
    getEligibleReferralDisbursedAmount(
      {
        status: ApplicationStatus.DISBURSED,
        loanAmount: 500_000,
      },
      0,
    ),
    null,
  );
  assert.equal(
    getEligibleReferralDisbursedAmount(
      { status: ApplicationStatus.DISBURSED, disbursedAmount: 0 },
      0,
    ),
    null,
  );
  assert.equal(
    getEligibleReferralDisbursedAmount(
      { status: ApplicationStatus.DISBURSED, disbursedAmount: 49_999 },
      50_000,
    ),
    null,
  );
});

test("referral codes use a normalized, scalable ObjectId-backed namespace", () => {
  const firstId = new Types.ObjectId();
  const secondId = new Types.ObjectId();
  const first = buildUserReferralCode(firstId);
  const second = buildUserReferralCode(secondId);

  assert.match(first, /^FINTARAA[0-9A-F]{24}$/);
  assert.equal(first.length, 32);
  assert.notEqual(first, second);
  assert.equal(buildUserReferralCode(firstId), first);
  assert.equal(buildUserReferralCode(firstId, "A1B2C3D4E5F6").length, 32);
  assert.equal(normalizeReferralCode("  ref-Abc-123  "), "REF-ABC-123");
});

test("user validation assigns missing codes without rewriting legacy codes", async () => {
  const generatedUser = new User({
    name: "Generated Code",
    mobile: "9000000001",
    role: "user",
    agreedToTerms: true,
    privacyPolicyAccepted: true,
  });
  await generatedUser.validate();
  assert.equal(
    generatedUser.referralCode,
    buildUserReferralCode(generatedUser._id),
  );

  const legacyUser = new User({
    name: "Legacy Code",
    mobile: "9000000002",
    role: "user",
    referralCode: "LEGACY-42",
    agreedToTerms: true,
    privacyPolicyAccepted: true,
  });
  await legacyUser.validate();
  assert.equal(legacyUser.referralCode, "LEGACY-42");
});

test("existing accounts cannot acquire or overwrite attribution from input", () => {
  assert.equal(
    getReferralAttributionDecision({
      isNewRegistration: false,
      requestedReferrerId: "referrer-a",
    }),
    "ignore",
  );
  assert.equal(
    getReferralAttributionDecision({
      isNewRegistration: false,
      storedReferrerId: "referrer-a",
      requestedReferrerId: "referrer-a",
    }),
    "repair",
  );
  assert.equal(
    getReferralAttributionDecision({
      isNewRegistration: true,
      storedReferrerId: "referrer-a",
      requestedReferrerId: "referrer-b",
    }),
    "conflict",
  );
  assert.equal(
    getReferralAttributionDecision({
      isNewRegistration: true,
      requestedReferrerId: "referrer-a",
    }),
    "attach",
  );
});

test("duplicate retries are limited specifically to referral-code collisions", () => {
  assert.equal(
    isReferralCodeDuplicateError({
      code: 11000,
      keyPattern: { referralCode: 1 },
    }),
    true,
  );
  assert.equal(
    isReferralCodeDuplicateError({ code: 11000, keyPattern: { mobile: 1 } }),
    false,
  );
  assert.equal(isReferralCodeDuplicateError({ code: 121 }), false);
});

test("reward points are credited at most once when disbursal sync is retried", async (t) => {
  const eventId = new Types.ObjectId();
  const referrerId = new Types.ObjectId();
  const referredUserId = new Types.ObjectId();
  const loanQueryId = new Types.ObjectId();
  let creditedPoints = 0;
  let hasCreditMarker = false;
  let incrementCalls = 0;
  const event: any = {
    _id: eventId,
    referrer: referrerId,
    referredUser: referredUserId,
    status: "pending",
    lifecycleStage: "approved",
    payoutStatus: "not_eligible",
    appliedAt: new Date("2026-01-01T00:00:00.000Z"),
    approvedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  t.mock.method(
    ReferralProgramConfig as any,
    "findOneAndUpdate",
    () =>
      Promise.resolve({
        isActive: true,
        rewardAmount: 500,
        minimumDisbursementAmount: 50_000,
      }),
  );
  t.mock.method(ReferralEvent as any, "findOne", () => ({
    sort: () => Promise.resolve(event),
  }));
  t.mock.method(
    ReferralEvent as any,
    "findOneAndUpdate",
    (_filter: any, update: any) => {
      Object.assign(event, update.$set || {});
      return Promise.resolve(event);
    },
  );
  t.mock.method(
    ReferralEvent as any,
    "findByIdAndUpdate",
    (_id: any, update: any) => {
      Object.assign(event, update.$set || {});
      return Promise.resolve(event);
    },
  );
  t.mock.method(User as any, "updateOne", (_filter: any, update: any) => {
    if (update.$inc) {
      if (hasCreditMarker) {
        return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
      }
      incrementCalls += 1;
      creditedPoints += Number(update.$inc.referralPoints || 0);
    }
    hasCreditMarker = true;
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  });
  t.mock.method(User as any, "exists", () =>
    Promise.resolve(hasCreditMarker ? { _id: referrerId } : null),
  );
  t.mock.method(
    notificationService as any,
    "sendSingleNotification",
    () => Promise.resolve(null),
  );

  const loanQuery = {
    _id: loanQueryId,
    customerId: referredUserId,
    status: ApplicationStatus.DISBURSED,
    disbursedAmount: 100_000,
    disbursedDate: new Date("2026-01-03T00:00:00.000Z"),
  };
  await creditReferralRewardOnDisbursal(String(referredUserId), loanQuery);
  await creditReferralRewardOnDisbursal(String(referredUserId), loanQuery);

  assert.equal(creditedPoints, 50_000);
  assert.equal(incrementCalls, 1);
  assert.equal(event.rewardCreditedAt instanceof Date, true);
});

test("wallet balance deducts legacy payouts, wallet payouts, and reservations", () => {
  assert.deepEqual(
    calculateReferralWalletBalances({
      lifetimeCredited: 2_000,
      reservedAmount: 700,
      legacyPaidAmount: 500,
      walletPaidAmount: 300,
    }),
    {
      lifetimeCredited: 2_000,
      reservedAmount: 700,
      paidAmount: 800,
      availableAmount: 500,
      legacyPaidAmount: 500,
      walletPaidAmount: 300,
    },
  );
  assert.equal(
    calculateReferralWalletBalances({
      lifetimeCredited: 500,
      reservedAmount: 500,
      legacyPaidAmount: 500,
      walletPaidAmount: 0,
    }).availableAmount,
    0,
  );
});

test("wallet request amount enforces minimum, precision, and available funds", () => {
  assert.equal(MINIMUM_REFERRAL_PAYOUT_AMOUNT, 500);
  assert.equal(validateReferralPayoutAmount(500, 500), 500);
  assert.throws(() => validateReferralPayoutAmount(499.99, 2_000));
  assert.throws(() => validateReferralPayoutAmount(500.001, 2_000));
  assert.throws(() => validateReferralPayoutAmount(1_001, 1_000));
});

test("wallet request amount accepts the maximum and cleanly rejects one paisa over", () => {
  assert.equal(MAXIMUM_REFERRAL_PAYOUT_AMOUNT, 100_000_000);
  assert.equal(
    validateReferralPayoutAmount(
      MAXIMUM_REFERRAL_PAYOUT_AMOUNT,
      MAXIMUM_REFERRAL_PAYOUT_AMOUNT + 500,
    ),
    MAXIMUM_REFERRAL_PAYOUT_AMOUNT,
  );
  assert.throws(
    () =>
      validateReferralPayoutAmount(
        MAXIMUM_REFERRAL_PAYOUT_AMOUNT + 0.01,
        MAXIMUM_REFERRAL_PAYOUT_AMOUNT + 500,
      ),
    (error: any) =>
      error?.statusCode === 400 && /cannot exceed/i.test(error?.message),
  );
});

test("wallet model has a unique active reservation lock per user", () => {
  const amountPath = ReferralPayoutRequest.schema.path("amount") as any;
  assert.equal(amountPath.options.min, MINIMUM_REFERRAL_PAYOUT_AMOUNT);
  assert.equal(amountPath.options.max, MAXIMUM_REFERRAL_PAYOUT_AMOUNT);
  const activeIndex = ReferralPayoutRequest.schema
    .indexes()
    .find(([, options]) => options?.name === "one_active_referral_payout_per_user");
  assert.ok(activeIndex);
  assert.equal(activeIndex?.[1]?.unique, true);
  assert.deepEqual(activeIndex?.[1]?.partialFilterExpression, {
    fundsReserved: true,
  });
});

test("paid transition uses an atomic approved reservation filter and is idempotent", async (t) => {
  const requestId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  let capturedFilter: any;
  let capturedUpdate: any;

  t.mock.method(
    ReferralPayoutRequest as any,
    "findOneAndUpdate",
    (filter: any, update: any) => {
      capturedFilter = filter;
      capturedUpdate = update;
      return Promise.resolve(null);
    },
  );
  t.mock.method(ReferralPayoutRequest as any, "findById", () => {
    const chain: any = {
      populate: () => chain,
      lean: () =>
        Promise.resolve({
          _id: requestId,
          user: { _id: userId, name: "Referrer" },
          amount: 500,
          status: "paid",
          fundsReserved: false,
          adminReference: "UTR-123",
          paymentNote: "Manual transfer confirmed",
          paidAt: new Date(),
        }),
    };
    return chain;
  });

  const result = await referralWalletService.markPaid({
    requestId: String(requestId),
    adminId: String(adminId),
    adminReference: "UTR-123",
    adminNote: "Manual transfer confirmed",
  });

  assert.equal(result.changed, false);
  assert.equal(result.request.status, "paid");
  assert.equal(capturedFilter.status, "approved");
  assert.equal(capturedFilter.fundsReserved, true);
  assert.equal(capturedUpdate.$set.status, "paid");
  assert.equal(capturedUpdate.$set.fundsReserved, false);
});

test("legacy direct event payout endpoint is disabled", async () => {
  let capturedError: any;
  await AdminReferralController.processPayout(
    {} as any,
    {} as any,
    ((error: any) => {
      capturedError = error;
    }) as any,
  );
  assert.equal(capturedError?.statusCode, 410);
  assert.match(String(capturedError?.message), /payout requests/i);
});

test("concurrent duplicate-key wallet create is returned as active-request conflict", async (t) => {
  const service: any = new ReferralWalletService();
  service.getActiveUser = async () => ({
    _id: new Types.ObjectId(),
    referralPoints: 100_000,
  });
  service.computeWallet = async () => ({
    balances: { availableAmount: 1_000 },
    activeRequest: null,
  });
  t.mock.method(ReferralPayoutRequest as any, "create", () => {
    const error: any = new Error("duplicate active reservation");
    error.code = 11000;
    return Promise.reject(error);
  });

  await assert.rejects(
    () => service.createRequest(String(new Types.ObjectId()), 500),
    (error: any) => error?.statusCode === 409,
  );
});

test("approve is pending-only and reject atomically releases reservation", async (t) => {
  const requestId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const filters: any[] = [];
  const updates: any[] = [];
  let targetStatus = "approved";
  const fakeDocument: any = {
    populate: async () => fakeDocument,
    toObject: () => ({
      _id: requestId,
      user: { _id: userId },
      amount: 500,
      status: targetStatus,
      fundsReserved: targetStatus === "approved",
    }),
  };
  t.mock.method(
    ReferralPayoutRequest as any,
    "findOneAndUpdate",
    (filter: any, update: any) => {
      filters.push(filter);
      updates.push(update);
      return Promise.resolve(fakeDocument);
    },
  );

  const approved = await referralWalletService.approve(
    String(requestId),
    String(adminId),
    "Reviewed",
  );
  assert.equal(approved.changed, true);
  assert.equal(filters[0].status, "pending");
  assert.equal(filters[0].fundsReserved, true);

  targetStatus = "rejected";
  const rejected = await referralWalletService.reject(
    String(requestId),
    String(adminId),
    "Verification failed",
  );
  assert.equal(rejected.changed, true);
  assert.deepEqual(filters[1].status, { $in: ["pending", "approved"] });
  assert.equal(filters[1].fundsReserved, true);
  assert.equal(updates[1].$set.status, "rejected");
  assert.equal(updates[1].$set.fundsReserved, false);
});

test("mark-paid requires both manual reference and note", async () => {
  const requestId = String(new Types.ObjectId());
  const adminId = String(new Types.ObjectId());
  await assert.rejects(
    () =>
      referralWalletService.markPaid({
        requestId,
        adminId,
        adminReference: "",
        adminNote: "Transferred",
      }),
    (error: any) => error?.statusCode === 400,
  );
  await assert.rejects(
    () =>
      referralWalletService.markPaid({
        requestId,
        adminId,
        adminReference: "UTR-123",
        adminNote: "",
      }),
    (error: any) => error?.statusCode === 400,
  );
});
