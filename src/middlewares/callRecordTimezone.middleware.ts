import { NextFunction, Request, Response } from "express";
import { DEFAULT_QUERY_TIMEZONE, parseDateInTimeZone } from "../utils/helper";

type TimezoneRequest = Request & {
  timezone?: string;
};

const normalizeRequestDate = (value: unknown, boundary: "start" | "end") => {
  const parsed = parseDateInTimeZone(value, boundary, DEFAULT_QUERY_TIMEZONE);
  return parsed || value;
};

export const callRecordTimezoneMiddleware = (
  req: TimezoneRequest,
  _res: Response,
  next: NextFunction,
) => {
  req.timezone = DEFAULT_QUERY_TIMEZONE;

  if (req.body && typeof req.body === "object") {
    if (req.body.callbackAt !== undefined) {
      req.body.callbackAt = normalizeRequestDate(req.body.callbackAt, "start");
    }
  }

  if (req.query && typeof req.query === "object") {
    if (req.query.callbackStart !== undefined) {
      req.query.callbackStart = normalizeRequestDate(
        req.query.callbackStart,
        "start",
      ) as any;
    }
    if (req.query.callbackEnd !== undefined) {
      req.query.callbackEnd = normalizeRequestDate(
        req.query.callbackEnd,
        "end",
      ) as any;
    }
  }

  next();
};

export default callRecordTimezoneMiddleware;
