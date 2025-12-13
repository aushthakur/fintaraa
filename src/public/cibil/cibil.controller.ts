import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import {
  fetchSurepassCibilReport,
  prepareSurepassCibilPayload,
} from "../../services/surepass.service";
import { User } from "../../modals/user.model";
import { fetchEncryptedCibilReport } from "../../services/surepassEncrypted.service";

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

    const now = new Date();
    const lastFetched = user.cibilLastFetchedAt
      ? new Date(user.cibilLastFetchedAt)
      : null;
    const msDiff = lastFetched ? now.getTime() - lastFetched.getTime() : null;
    const daysSinceFetch = msDiff ? msDiff / (1000 * 60 * 60 * 24) : null;
    const refreshLocked = daysSinceFetch !== null && daysSinceFetch < 30;
    const daysRemaining = Math.max(0, Math.ceil(30 - (daysSinceFetch || 0)));
    const cachedReport = (user as any)?.cibilReport || null;
    const cachedPayload = (user as any)?.cibilRequestPayload || null;

    console.log(user);

    if (!forceRefresh && user.cibilScore && refreshLocked) {
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          report: cachedReport,
          payload: cachedPayload,
          cibilScore: user.cibilScore,
          refreshAvailableInDays: daysRemaining,
          lastFetchedAt: user.cibilLastFetchedAt,
          message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        })
      );
    }

    if (forceRefresh && refreshLocked) {
      // Respond with cached score (if any) instead of throwing, so UI can still show the latest value.
      return res.status(200).json(
        new ApiResponse(200, {
          cached: true,
          cibilScore: user.cibilScore || null,
          lastFetchedAt: user.cibilLastFetchedAt,
          report: cachedReport,
          payload: cachedPayload,
          refreshAvailableInDays: daysRemaining,
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
    const score =
      report.data?.score ||
      report.data?.cibil_score ||
      report.data?.data?.score ||
      null;

    user.cibilScore = score || user.cibilScore;
    user.cibilLastFetchedAt = now;
    (user as any).cibilReport = report.data;
    (user as any).cibilRequestPayload = payload;
    await user.save();

    return res.status(200).json(
      new ApiResponse(200, {
        cached: false,
        payload,
        report: report.data,
        environment: report.environment,
        refreshAvailableInDays: daysRemaining,
        lastFetchedAt: user.cibilLastFetchedAt,
        message: `CIBIL can be refreshed again in ${daysRemaining} day(s).`,
        ...(score ? { cibilScore: score } : {}),
      })
    );
  } catch (error) {
    return next(error);
  }
};
