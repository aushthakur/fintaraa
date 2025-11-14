import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import {
  fetchSurepassCibilReport,
  prepareSurepassCibilPayload,
} from "../../services/surepass.service";
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
