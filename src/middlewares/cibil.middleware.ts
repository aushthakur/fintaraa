import { NextFunction, Request, Response } from "express";
import {
  fetchSurepassCibilReport,
  prepareSurepassCibilPayload,
  SurepassCibilInput,
} from "../services/surepass.service";

/**
 * Middleware to fetch the CIBIL report from Surepass before hitting controller logic.
 * Attaches the response to req.body.cibilReport and extracted score (if present).
 */
export const cibilScoreMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = prepareSurepassCibilPayload(req.body as SurepassCibilInput);
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

    (req.body as any).cibilRequestPayload = payload;
    (req.body as any).cibilReport = report.data;
    (req.body as any).cibilEnvironment = report.environment;

    const score =
      report.data?.score ||
      report.data?.cibil_score ||
      report.data?.data?.score ||
      null;

    if (score) {
      (req.body as any).cibilScore = score;
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
