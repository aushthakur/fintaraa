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
import { rewardReferralIfEligible } from "../../services/referral.service";
import { fetchEncryptedCibilReport } from "../../services/surepassEncrypted.service";
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";

export const fetchCibilReport = async (
  req: Request,
  res: Response,
  next: NextFunction
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
      })
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchCibilReportWithMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { cibilReport, cibilScore, cibilEnvironment, cibilRequestPayload } =
      req.body;
    if (!cibilReport) {
      throw new ApiError(
        500,
        "CIBIL report is unavailable after middleware execution"
      );
    }

    return res.status(200).json(
      new ApiResponse(200, {
        payload: cibilRequestPayload,
        environment: cibilEnvironment,
        report: cibilReport,
        ...(cibilScore ? { cibilScore } : {}),
      })
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchEncryptedCibilReportController = async (
  req: Request,
  res: Response,
  next: NextFunction
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
      })
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchUserCibilReport = async (
  req: Request | any,
  res: Response,
  next: NextFunction
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
      console.log(
        "Returning cached CIBIL score, refresh locked. Days remaining:",
        daysRemaining
      );
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
        })
      );
    }

    if (forceRefresh && refreshLocked) {
      // Respond with cached score (if any) instead of throwing, so UI can still show the latest value.
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
        })
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
          }`
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
        }`
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
      })
    );
  } catch (error) {
    return next(error);
  }
};

export const fetchUserCibilPdfReport = async (
  req: Request | any,
  res: Response,
  next: NextFunction
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
        })
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
      })
    );
  } catch (error) {
    return next(error);
  }
};
