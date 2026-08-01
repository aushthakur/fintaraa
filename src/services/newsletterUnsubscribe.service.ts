import crypto from "crypto";
import { config } from "../config/config";

const normalizeEmail = (value: unknown) =>
  String(value || "").trim().toLowerCase();

const tokenFor = (email: string) =>
  crypto
    .createHmac("sha256", config.jwt.secret)
    .update(`newsletter-unsubscribe:${normalizeEmail(email)}`)
    .digest("hex");

export const createNewsletterUnsubscribeToken = (email: string) =>
  tokenFor(email);

export const verifyNewsletterUnsubscribeToken = (
  email: string,
  token: string,
) => {
  const expected = Buffer.from(tokenFor(email), "hex");
  const received = Buffer.from(String(token || "").trim(), "hex");
  return (
    expected.length === received.length &&
    expected.length > 0 &&
    crypto.timingSafeEqual(expected, received)
  );
};

export const getNewsletterUnsubscribeUrl = (email: string) => {
  const apiBase = String(config.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const base = apiBase
    ? `${apiBase}/api/newsletter/unsubscribe`
    : "/api/newsletter/unsubscribe";
  const query = new URLSearchParams({
    email: normalizeEmail(email),
    token: createNewsletterUnsubscribeToken(email),
  });
  return `${base}?${query.toString()}`;
};
