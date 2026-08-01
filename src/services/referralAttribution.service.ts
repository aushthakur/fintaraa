import { Types } from "mongoose";
import ApiError from "../utils/ApiError";
import { ReferralEvent } from "../modals/referralEvent.model";
import { ReferralVisit } from "../modals/referralVisit.model";
import {
  RegistrationSource,
  User,
  UserStatus,
} from "../modals/user.model";
import {
  buildReferralCodeRetryEntropy,
  buildUserReferralCode,
  getReferralAttributionDecision,
  isReferralCodeDuplicateError,
  normalizeReferralCode,
} from "../utils/referral";

const idOf = (value: any): string =>
  String(value?._id || value || "").trim();

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * New codes are canonical uppercase values. The case-insensitive fallback
 * keeps old links working without rewriting legacy user documents.
 */
export const findEligibleReferrerByCode = async (rawCode: unknown) => {
  const referralCode = normalizeReferralCode(rawCode);
  if (!referralCode) return null;

  const eligibility = {
    role: "user",
    status: UserStatus.ACTIVE,
    isDeleted: { $ne: true },
  };
  const exact = await User.findOne({
    ...eligibility,
    referralCode,
  });
  if (exact) return exact;

  return User.findOne({
    ...eligibility,
    referralCode: new RegExp(`^${escapeRegex(referralCode)}$`, "i"),
  });
};

const markReferralVisitConverted = async ({
  referrerId,
  referralCode,
  convertedUserId,
  visitorId,
}: {
  referrerId: any;
  referralCode: string;
  convertedUserId: any;
  visitorId?: string;
}) => {
  const normalizedVisitorId = String(visitorId || "").trim();
  if (!normalizedVisitorId) return null;

  return ReferralVisit.findOneAndUpdate(
    {
      recordType: "referral_visit",
      referrer: referrerId,
      referralCode: normalizeReferralCode(referralCode),
      visitorId: normalizedVisitorId,
      $or: [
        { convertedUser: { $exists: false } },
        { convertedUser: null },
      ],
    },
    {
      $set: {
        convertedUser: convertedUserId,
        convertedAt: new Date(),
      },
    },
    { sort: { createdAt: -1 }, new: true },
  );
};

const upsertReferralEvent = async (user: any, referrer: any) => {
  let event: any;
  try {
    event = await ReferralEvent.findOneAndUpdate(
      { referredUser: user._id },
      {
        $setOnInsert: {
          referrer: referrer._id,
          referredUser: user._id,
          referralCode: normalizeReferralCode(referrer.referralCode),
          status: "pending",
          points: 0,
          lifecycleStage: "registered",
          payoutStatus: "not_eligible",
          registeredAt: user.createdAt || new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error: any) {
    // Concurrent createUser/OTP completion requests may race on the unique
    // referredUser index. The winner's event is the authoritative record.
    if (error?.code !== 11000 && error?.errorResponse?.code !== 11000) {
      throw error;
    }
    event = await ReferralEvent.findOne({ referredUser: user._id });
  }

  if (!event) {
    throw new ApiError(500, "Referral history could not be created");
  }
  if (idOf(event.referrer) !== idOf(referrer._id)) {
    throw new ApiError(
      409,
      "Conflicting referral attribution already exists for this account",
    );
  }
  return event;
};

/**
 * Repairs the second half of an attribution if a prior request saved
 * user.referredBy but failed before ReferralEvent creation.
 */
export const repairStoredReferralAttribution = async (user: any) => {
  const storedReferrerId = idOf(user?.referredBy);
  if (!storedReferrerId) return null;

  const referrer = await User.findById(storedReferrerId).select(
    "_id referralCode",
  );
  if (!referrer?.referralCode) return null;
  return upsertReferralEvent(user, referrer);
};

/** Attribution from request input is allowed only for a newly-created user. */
export const attachReferralToNewRegistration = async (
  user: any,
  rawReferralCode: unknown,
  visitorId?: string,
) => {
  const referralCode = normalizeReferralCode(rawReferralCode);
  if (!referralCode) return repairStoredReferralAttribution(user);

  const referrer: any = await findEligibleReferrerByCode(referralCode);
  if (!referrer || idOf(referrer._id) === idOf(user?._id)) {
    throw new ApiError(400, "Invalid referral code");
  }

  const decision = getReferralAttributionDecision({
    storedReferrerId: user?.referredBy,
    requestedReferrerId: referrer._id,
    isNewRegistration: true,
  });
  if (decision === "conflict") {
    throw new ApiError(
      409,
      "This account is already attributed to another referrer",
    );
  }

  if (decision === "attach") {
    const result = await User.updateOne(
      {
        _id: user._id,
        $or: [{ referredBy: { $exists: false } }, { referredBy: null }],
      },
      {
        $set: {
          referredBy: referrer._id,
          registrationSource: RegistrationSource.REFERRAL,
        },
      },
    );

    if (result.modifiedCount === 0) {
      const current = await User.findById(user._id).select("referredBy");
      if (idOf(current?.referredBy) !== idOf(referrer._id)) {
        throw new ApiError(
          409,
          "This account is already attributed to another referrer",
        );
      }
    }
    user.referredBy = referrer._id;
    user.registrationSource = RegistrationSource.REFERRAL;
  }

  const event = await upsertReferralEvent(user, referrer);
  await markReferralVisitConverted({
    referrerId: referrer._id,
    referralCode: referrer.referralCode,
    convertedUserId: user._id,
    visitorId,
  });
  return event;
};

export const createUserWithReferralCode = async (data: any) => {
  const userId = data?._id || new Types.ObjectId();
  const suppliedCode = normalizeReferralCode(data?.referralCode);
  const maxAttempts = suppliedCode ? 1 : 4;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const referralCode =
      suppliedCode ||
      buildUserReferralCode(
        userId,
        attempt > 0 ? buildReferralCodeRetryEntropy() : "",
      );
    try {
      return await User.create({ ...data, _id: userId, referralCode });
    } catch (error) {
      if (
        suppliedCode ||
        !isReferralCodeDuplicateError(error) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw new ApiError(500, "Failed to allocate a unique referral code");
};

/** Backfills legacy/placeholder users without replacing an existing code. */
export const ensureUserReferralCode = async (user: any) => {
  if (user?.referralCode) return user.referralCode;

  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    user.referralCode = buildUserReferralCode(
      user._id,
      attempt > 0 ? buildReferralCodeRetryEntropy() : "",
    );
    try {
      await user.save();
      return user.referralCode;
    } catch (error) {
      if (
        !isReferralCodeDuplicateError(error) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
      user.referralCode = undefined;
    }
  }

  throw new ApiError(500, "Failed to allocate a unique referral code");
};
