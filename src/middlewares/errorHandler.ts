import { logger } from "../config/logger";
import { config as manualConfig } from "../config/config";
import { Request, Response, NextFunction } from "express";

export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.status || 500;
  const message = err.message || "Internal Server Error";

  console.log("Error: ", err);
  logger.error(
    `[${new Date().toISOString()}] Error on ${req.method} ${req.originalUrl
    } - Status: ${statusCode} - Message: ${message}`,
    { stack: err.stack }
  );

  res.status(statusCode).json({
    success: false,
    message,
    // Include stack trace only in development for debugging
    ...(manualConfig.env === "development" && { stack: err.stack }),
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
};
