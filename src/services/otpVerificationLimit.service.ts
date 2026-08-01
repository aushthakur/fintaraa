import crypto from "crypto";
import ApiError from "../utils/ApiError";
import { OtpVerificationAttempt } from "../modals/otpVerificationAttempt.model";

const MOBILE_WINDOW_MS = 5 * 60 * 1000;
const IP_WINDOW_MS = 15 * 60 * 1000;
const MOBILE_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;

const digest = (value: unknown) =>
  crypto.createHash("sha256").update(String(value || "unknown")).digest("hex");

const keysFor = (mobile: string, ip: unknown) => [
  {
    dimension: "mobile" as const,
    keyHash: digest(mobile),
    maxFailures: MOBILE_MAX_FAILURES,
    windowMs: MOBILE_WINDOW_MS,
  },
  {
    dimension: "ip" as const,
    keyHash: digest(String(ip || "unknown").trim().toLowerCase()),
    maxFailures: IP_MAX_FAILURES,
    windowMs: IP_WINDOW_MS,
  },
];

export const assertOtpVerificationAllowed = async (
  mobile: string,
  scope: "user" | "agency",
  ip: unknown,
) => {
  const now = new Date();
  const keys = keysFor(mobile, ip);
  const blocked = await OtpVerificationAttempt.exists({
    scope,
    $or: keys.map(({ dimension, keyHash, maxFailures }) => ({
      dimension,
      keyHash,
      expiresAt: { $gt: now },
      $or: [
        { lockedUntil: { $gt: now } },
        { failures: { $gte: maxFailures } },
      ],
    })),
  });
  if (blocked) {
    throw new ApiError(429, "Too many invalid OTP attempts. Request a new OTP or try again later.");
  }
};

const incrementCounter = async (
  scope: "user" | "agency",
  key: ReturnType<typeof keysFor>[number],
) => {
  const now = new Date();
  await OtpVerificationAttempt.deleteOne({
    scope,
    dimension: key.dimension,
    keyHash: key.keyHash,
    expiresAt: { $lte: now },
  });
  let counter: any;
  try {
    counter = await OtpVerificationAttempt.findOneAndUpdate(
      { scope, dimension: key.dimension, keyHash: key.keyHash },
      {
        $inc: { failures: 1 },
        $setOnInsert: { expiresAt: new Date(now.getTime() + key.windowMs) },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    counter = await OtpVerificationAttempt.findOneAndUpdate(
      { scope, dimension: key.dimension, keyHash: key.keyHash },
      { $inc: { failures: 1 } },
      { new: true },
    );
  }
  if (counter && counter.failures >= key.maxFailures && !counter.lockedUntil) {
    await OtpVerificationAttempt.updateOne(
      { _id: counter._id, failures: { $gte: key.maxFailures } },
      { $set: { lockedUntil: counter.expiresAt } },
    );
  }
  return counter;
};

export const recordOtpVerificationFailure = async (
  mobile: string,
  scope: "user" | "agency",
  ip: unknown,
) => {
  const counters = await Promise.all(
    keysFor(mobile, ip).map((key) => incrementCounter(scope, key)),
  );
  return counters.some((counter, index) =>
    Boolean(counter && counter.failures >= keysFor(mobile, ip)[index].maxFailures),
  );
};

export const resetOtpVerificationAttempts = async (
  mobile: string,
  scope: "user" | "agency",
  ip: unknown,
  options?: { includeIp?: boolean },
) => {
  const keys = keysFor(mobile, ip).filter(
    (key) => options?.includeIp !== false || key.dimension === "mobile",
  );
  await OtpVerificationAttempt.deleteMany({
    scope,
    $or: keys.map(({ dimension, keyHash }) => ({ dimension, keyHash })),
  });
};
