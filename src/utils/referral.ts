import crypto from "crypto";

export const REFERRAL_CODE_PREFIX = "FINTARAA";
export const MAX_REFERRAL_CODE_LENGTH = 32;

/**
 * Referral codes are case-insensitive at the API boundary. Existing stored
 * codes are intentionally left untouched; all newly written values use this
 * canonical form.
 */
export const normalizeReferralCode = (value: unknown): string =>
  String(value || "")
    .trim()
    .toUpperCase();

/**
 * ObjectIds are unique before persistence, so using the complete id avoids the
 * check-then-insert race and the tiny 900-value namespace used previously.
 * The optional retry entropy is only needed if a manually-created legacy code
 * happens to collide with the deterministic value.
 */
export const buildUserReferralCode = (
  userId: unknown,
  retryEntropy = "",
): string => {
  const idPart = String(userId || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  const entropyPart = normalizeReferralCode(retryEntropy).replace(
    /[^A-Z0-9]/g,
    "",
  );

  if (!idPart) {
    throw new Error("A user id is required to generate a referral code");
  }

  const bodyLength = MAX_REFERRAL_CODE_LENGTH - REFERRAL_CODE_PREFIX.length;
  if (!entropyPart) {
    return `${REFERRAL_CODE_PREFIX}${idPart.slice(-bodyLength)}`;
  }

  const retryPart = entropyPart.slice(0, Math.min(12, bodyLength));
  const stablePart = idPart.slice(-(bodyLength - retryPart.length));
  return `${REFERRAL_CODE_PREFIX}${stablePart}${retryPart}`;
};

export const buildReferralCodeRetryEntropy = (): string =>
  crypto.randomBytes(6).toString("hex").toUpperCase();

export const isReferralCodeDuplicateError = (error: any): boolean => {
  const code = error?.code ?? error?.errorResponse?.code;
  if (code !== 11000) return false;

  const keyPattern = error?.keyPattern || error?.errorResponse?.keyPattern || {};
  const keyValue = error?.keyValue || error?.errorResponse?.keyValue || {};
  const message = String(error?.message || "");
  return Boolean(
    keyPattern.referralCode ||
      Object.prototype.hasOwnProperty.call(keyValue, "referralCode") ||
      /referralCode/i.test(message),
  );
};

export type ReferralAttributionDecision =
  | "attach"
  | "repair"
  | "conflict"
  | "ignore";

/** Pure policy used by registration attribution and its regression tests. */
export const getReferralAttributionDecision = ({
  storedReferrerId,
  requestedReferrerId,
  isNewRegistration,
}: {
  storedReferrerId?: unknown;
  requestedReferrerId?: unknown;
  isNewRegistration: boolean;
}): ReferralAttributionDecision => {
  const stored = String(storedReferrerId || "").trim();
  const requested = String(requestedReferrerId || "").trim();

  if (stored) {
    if (requested && stored !== requested) return "conflict";
    return "repair";
  }
  if (!isNewRegistration || !requested) return "ignore";
  return "attach";
};
