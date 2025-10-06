import "colors";
import { config } from "./config";
import { RequestHandler } from "express";

const getClientIp = (req: any): string => {
  let ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  // Normalize IPv6 loopback or IPv4-mapped IPv6 to standard IPv4
  if (ip === "::1" || ip === "::ffff:127.0.0.1") ip = "127.0.0.1";
  return ip;
};

export const ipBlocker: RequestHandler = (req, res, next) => {
  const ip = getClientIp(req);
  if (config.security.ips.includes(ip)) {
    const msg = `[IP BLOCKED] Access denied for IP: ${ip}`;
    console.log(msg.red.bold);
    res.status(403).json({
      statusCode: 403,
      success: false,
      ip,
      message: "Access denied from this IP address.",
    });
    console.log(`[WARNING] IP blocked but in warn mode: ${ip}`.yellow);
    return;
  }
  next();
};
