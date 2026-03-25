import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import {
  fetchSurepassCibilReport,
  fetchSurepassCibilPdfReport,
  prepareSurepassCibilPayload,
} from "../../services/surepass.service";
import { ConsentHistory } from "../../modals/consentHistory.model";
import { KycVerificationStatus, User } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import { rewardReferralIfEligible } from "../../services/referral.service";
import { fetchEncryptedCibilReport } from "../../services/surepassEncrypted.service";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";

type ScoreBureau = "cibil" | "experian";

const SCORE_PRICING_INR: Record<ScoreBureau, number> = {
  cibil: 99,
  experian: 50,
};

const toNumber = (value: any) => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBureau = (value: any): ScoreBureau | null => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["cibil", "cibil_score", "cibilscore"].includes(raw)) return "cibil";
  if (
    ["experian", "experian_score", "experianscore"].includes(raw)
  ) {
    return "experian";
  }
  return null;
};

const extractScore = (report: any) =>
  toNumber(
    report?.data?.credit_score ||
      report?.data?.score ||
      report?.data?.cibil_score ||
      report?.score ||
      report?.cibil_score,
  ) || 0;

const buildCibilPayloadFromActor = (actor: any) => {
  const kycPersonal = actor?.kycProfile?.personalDetails || {};
  return prepareSurepassCibilPayload({
    mobile: actor?.mobile,
    panCard: actor?.panCard || kycPersonal?.panNumber,
    name: actor?.name || kycPersonal?.fullName,
    consent: "Y",
    gender:
      String(actor?.gender || kycPersonal?.gender || "male").toLowerCase() ===
      "female"
        ? "female"
        : "male",
  });
};

const getActorScoreWallet = (actor: any) => ({
  cibilCredits: toNumber(actor?.cibilScoreCheckCredits),
  experianCredits: toNumber(actor?.experianScoreCheckCredits),
});

const setActorScoreWallet = (
  actor: any,
  next: { cibilCredits: number; experianCredits: number },
) => {
  actor.cibilScoreCheckCredits = Math.max(0, toNumber(next.cibilCredits));
  actor.experianScoreCheckCredits = Math.max(0, toNumber(next.experianCredits));
};

const deriveExperianScore = (seed: string, cibilScore?: number) => {
  const base = toNumber(cibilScore) > 0 ? toNumber(cibilScore) : 700;
  let hash = 0;
  for (const char of String(seed || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  }
  const offset = (hash % 61) - 30;
  return Math.max(300, Math.min(900, base + offset));
};

const resolveActorForPaidScore = async (req: Request | any) => {
  const actorId = req.user?._id;
  const role = String(req.user?.role || "").toLowerCase();
  if (!actorId) throw new ApiError(401, "Unauthorized");

  if (role === "agency" || role === "agency_member") {
    const agency = await Agency.findById(actorId);
    if (!agency) throw new ApiError(404, "Agency not found");
    return { actor: agency, actorType: "agency" as const };
  }

  const user = await User.findById(actorId);
  if (user) return { actor: user, actorType: "user" as const };

  const agency = await Agency.findById(actorId);
  if (agency) return { actor: agency, actorType: "agency" as const };

  throw new ApiError(404, "Account not found");
};

export const getCreditScorePricing = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          currency: "INR",
          plans: {
            cibil: {
              bureau: "cibil",
              amount: SCORE_PRICING_INR.cibil,
              label: "CIBIL Score",
            },
            experian: {
              bureau: "experian",
              amount: SCORE_PRICING_INR.experian,
              label: "Experian Score",
            },
          },
        },
        "Credit score pricing fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const getCreditScoreWallet = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { actor, actorType } = await resolveActorForPaidScore(req);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          actorType,
          wallet: getActorScoreWallet(actor),
          pricing: SCORE_PRICING_INR,
        },
        "Credit score wallet fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const purchaseCreditScoreCheck = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { actor, actorType } = await resolveActorForPaidScore(req);
    const bureau = normalizeBureau(req.body?.bureau);
    if (!bureau) {
      throw new ApiError(400, "bureau must be either 'cibil' or 'experian'");
    }

    const quantity = Math.max(1, Math.floor(toNumber(req.body?.quantity) || 1));
    const expectedAmount = SCORE_PRICING_INR[bureau] * quantity;
    const paidAmount = toNumber(req.body?.paidAmount ?? req.body?.amount);
    if (paidAmount > 0 && paidAmount < expectedAmount) {
      throw new ApiError(
        400,
        `Paid amount is less than required amount ₹${expectedAmount}`,
      );
    }

    const wallet = getActorScoreWallet(actor);
    if (bureau === "cibil") wallet.cibilCredits += quantity;
    else wallet.experianCredits += quantity;
    setActorScoreWallet(actor, wallet);
    actor.lastScorePurchaseAt = new Date();
    await actor.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          actorType,
          bureau,
          quantity,
          pricing: SCORE_PRICING_INR[bureau],
          expectedAmount,
          wallet,
          purchasedAt: actor.lastScorePurchaseAt,
        },
        "Credit score check purchased successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchPaidCreditScore = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { actor, actorType } = await resolveActorForPaidScore(req);
    const bureau = normalizeBureau(req.body?.bureau);
    const forceRefresh = Boolean(req.body?.forceRefresh);

    if (!bureau) {
      throw new ApiError(400, "bureau must be either 'cibil' or 'experian'");
    }

    const wallet = getActorScoreWallet(actor);
    const hasCredit =
      bureau === "cibil" ? wallet.cibilCredits > 0 : wallet.experianCredits > 0;

    if (bureau === "cibil") {
      const cachedScore = toNumber(actor?.cibilScore);
      const cachedReport = actor?.cibilReport || null;
      if (!forceRefresh && cachedScore > 0 && cachedReport) {
        return res.status(200).json(
          new ApiResponse(
            200,
            {
              actorType,
              bureau,
              cached: true,
              cibilScore: cachedScore,
              report: cachedReport,
              lastFetchedAt: actor?.cibilLastFetchedAt,
              wallet,
            },
            "CIBIL score fetched successfully",
          ),
        );
      }

      if (!hasCredit) {
        throw new ApiError(
          402,
          `Insufficient ${bureau.toUpperCase()} credits. Please purchase first.`,
        );
      }

      const payload = buildCibilPayloadFromActor(actor);
      const report = await fetchSurepassCibilReport(payload);
      const score = extractScore(report.data);

      actor.cibilScore = score || actor.cibilScore;
      actor.cibilLastFetchedAt = new Date();
      actor.cibilReport = report.data;
      actor.cibilRequestPayload = payload;

      if (bureau === "cibil") wallet.cibilCredits -= 1;
      setActorScoreWallet(actor, wallet);
      await actor.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            actorType,
            bureau,
            cached: false,
            cibilScore: score || null,
            report: report.data,
            lastFetchedAt: actor?.cibilLastFetchedAt,
            wallet,
          },
          "CIBIL score fetched successfully",
        ),
      );
    }

    const cachedScore = toNumber(actor?.experianScore);
    const cachedReport = actor?.experianReport || null;
    if (!forceRefresh && cachedScore > 0 && cachedReport) {
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            actorType,
            bureau,
            cached: true,
            experianScore: cachedScore,
            report: cachedReport,
            lastFetchedAt: actor?.experianLastFetchedAt,
            wallet,
          },
          "Experian score fetched successfully",
        ),
      );
    }

    if (!hasCredit) {
      throw new ApiError(
        402,
        `Insufficient ${bureau.toUpperCase()} credits. Please purchase first.`,
      );
    }

    const derivedScore = deriveExperianScore(
      String(actor?._id || ""),
      toNumber(actor?.cibilScore),
    );
    const report = {
      source: "derived_from_cibil",
      generatedAt: new Date().toISOString(),
      score: derivedScore,
      note: "Experian partner integration pending. Generated score is indicative.",
    };

    actor.experianScore = derivedScore;
    actor.experianReport = report;
    actor.experianLastFetchedAt = new Date();
    wallet.experianCredits -= 1;
    setActorScoreWallet(actor, wallet);
    await actor.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          actorType,
          bureau,
          cached: false,
          experianScore: derivedScore,
          report,
          lastFetchedAt: actor?.experianLastFetchedAt,
          wallet,
        },
        "Experian score fetched successfully",
      ),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchCibilReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const payload = prepareSurepassCibilPayload(req.body);
    const requestedEnv =
      (req.query?.environment as string)?.toLowerCase() ||
      (req.body?.environment as string)?.toLowerCase();

    const normalizedEnv =
      requestedEnv === "production"
        ? "production"
        : requestedEnv === "sandbox"
          ? "sandbox"
          : undefined;

    const report = await fetchSurepassCibilReport(payload, {
      environment: normalizedEnv,
    });

    const score =
      report.data?.score ||
      report.data?.cibil_score ||
      report.data?.data?.score ||
      null;

    return res.status(200).json(
      new ApiResponse(200, {
        payload,
        environment: report.environment,
        report: report.data,
        ...(score ? { cibilScore: score } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchCibilReportWithMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { cibilReport, cibilScore, cibilEnvironment, cibilRequestPayload } =
      req.body;
    if (!cibilReport) {
      throw new ApiError(
        500,
        "CIBIL report is unavailable after middleware execution",
      );
    }

    return res.status(200).json(
      new ApiResponse(200, {
        payload: cibilRequestPayload,
        environment: cibilEnvironment,
        report: cibilReport,
        ...(cibilScore ? { cibilScore } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchEncryptedCibilReportController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await fetchEncryptedCibilReport(req.body);
    const encryptedScore =
      result.response?.score ||
      result.response?.cibil_score ||
      result.response?.data?.score ||
      null;

    return res.status(200).json(
      new ApiResponse(200, {
        payload: result.payload,
        environment: "encrypted",
        report: result.response,
        ...(encryptedScore ? { cibilScore: encryptedScore } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchUserCibilReport = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { forceRefresh = false } = req.body || {};
    const userId = req.user?._id;

    if (!userId) {
      return next(new ApiError(401, "Unauthorized"));
    }

    const user = await User.findById(userId);
    if (!user) return next(new ApiError(404, "User not found"));
    const lastConsent = await ConsentHistory.findOne({
      user: userId,
      type: "cibil",
    })
      .sort({ collectedAt: -1 })
      .lean();

    const now = new Date();
    const lastFetched = user.cibilLastFetchedAt
      ? new Date(user.cibilLastFetchedAt)
      : null;
    const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
    const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
    const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
    const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
    const cachedReport = (user as any)?.cibilReport || null;
    const cachedScoreExists =
      (user as any)?.cibilReport?.data?.credit_score || null;
    const cachedPayload = (user as any)?.cibilRequestPayload || null;

    if (!forceRefresh && cachedScoreExists && refreshLocked) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          payload: cachedPayload,
          cibilScore: user.cibilScore,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilLastFetchedAt,
          lastConsentAt: lastConsent?.collectedAt,
          message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    }

    if (forceRefresh && refreshLocked) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          payload: cachedPayload,
          cibilScore: user.cibilScore || null,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilLastFetchedAt,
          lastConsentAt: lastConsent?.collectedAt,
          message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    }

    const payload = prepareSurepassCibilPayload({
      mobile: user.mobile,
      panCard: user.panCard,
      name: user.name,
      consent: "Y",
      gender:
        String(user.gender || "male").toLowerCase() === "female"
          ? "female"
          : "male",
    });

    const report = await fetchSurepassCibilReport(payload);
    const score = report.data?.data?.credit_score || 0;

    user.cibilScore = score || user.cibilScore;
    user.cibilLastFetchedAt = now;
    (user as any).cibilReport = report.data;
    (user as any).cibilRequestPayload = payload;
    if (score) {
      user.kycProfile = user.kycProfile || { reusableAcrossApplications: true };
      user.kycProfile.verification = {
        ...(user.kycProfile.verification || {}),
        status: KycVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      };
    }
    await user.save();
    if (score) {
      await ConsentHistory.create({
        user: userId,
        type: "cibil",
        channel: "app",
        status: "granted",
        partner: "surepass",
        purpose: "credit_report",
        scope: ["cibil_score", "credit_report"],
        collectedAt: now,
        metadata: {
          score,
          environment: report.environment,
        },
      });
      await rewardReferralIfEligible(userId);
      try {
        await sendSingleNotification({
          type: "kyc-verified",
          toUserId: userId,
          toRole: UserType.USER,
          fromUser: { _id: userId, role: UserType.USER },
          context: {},
        });
      } catch (error: any) {
        console.log(
          `[Notification] Failed to send kyc-verified: ${
            error?.message || error
          }`,
        );
      }
    }
    try {
      await sendSingleNotification({
        type: "cibil-fetched",
        toUserId: userId,
        toRole: UserType.USER,
        fromUser: { _id: userId, role: UserType.USER },
        context: { score: score || "" },
      });
    } catch (error: any) {
      console.log(
        `[Notification] Failed to send cibil-fetched: ${
          error?.message || error
        }`,
      );
    }
    return res.status(200).json(
      new ApiResponse(200, {
        cached: false,
        payload,
        report: report.data,
        environment: report.environment,
        refreshAvailableInDays: daysRemaining,
        lastFetchedAt: user.cibilLastFetchedAt,
        lastConsentAt: now,
        message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        ...(score ? { cibilScore: score } : {}),
      }),
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchUserCibilPdfReport = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    if (!userId) return next(new ApiError(401, "Unauthorized"));

    const user = await User.findById(userId);
    if (!user) return next(new ApiError(404, "User not found"));

    const now = new Date();
    const lastFetched = user.cibilPdfLastFetchedAt
      ? new Date(user.cibilPdfLastFetchedAt)
      : null;
    const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
    const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
    const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
    const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
    const cachedReport = (user as any)?.cibilPdfReport || null;
    const cachedLink =
      cachedReport?.data?.credit_report_link ||
      cachedReport?.data?.creditReportLink ||
      cachedReport?.credit_report_link ||
      cachedReport?.creditReportLink ||
      null;

    if (refreshLocked && cachedLink) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilPdfLastFetchedAt,
          message: `CIBIL PDF can be refreshed again in ${daysRemaining} day(s).`,
        }),
      );
    }

    const payload = prepareSurepassCibilPayload({
      name: user.name,
      mobile: user.mobile,
      panCard: user.panCard,
      consent: "Y",
      gender:
        String(user.gender || "male").toLowerCase() === "female"
          ? "female"
          : "male",
    });

    const normalizedEnv = "production";
    const report = await fetchSurepassCibilPdfReport(payload, {
      environment: normalizedEnv,
    });

    user.cibilPdfLastFetchedAt = now;
    (user as any).cibilPdfReport = report.data;
    await user.save();

    return res.status(200).json(
      new ApiResponse(200, {
        payload,
        cached: false,
        report: report.data,
        environment: report.environment,
        refreshAvailableInDays: daysRemaining,
        lastFetchedAt: user.cibilPdfLastFetchedAt,
        message: `CIBIL PDF can be refreshed again in ${daysRemaining} day(s).`,
      }),
    );
  } catch (error) {
    return next(error);
  }
};
