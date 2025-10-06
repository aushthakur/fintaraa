import { config } from "../config/config";
import rateLimit from "express-rate-limit";

const onLimitReached = (req: any, res: any, options: any) => {
  console.log(
    `Rate limit exceeded for IP: ${req.ip}, Route: ${
      req.originalUrl
    }, Time: ${new Date().toISOString()}`
  );
  res.status(options.statusCode).json({
    success: false,
    message: options.message,
    retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    timestamp: new Date().toISOString(),
  });
};

export const limiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
  statusCode: 429,
  skipFailedRequests: true,
  handler: onLimitReached,
});
