import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import axios from "axios";
import { config } from "../config/config";
import ApiError from "../utils/ApiError";
import { PartnerCredentialAuthType } from "../modals/partnerCredential.model";

type EncryptedPartnerCredentials = {
  version: number;
  iv: string;
  authTag: string;
  ciphertext: string;
};

const MAX_CREDENTIAL_BYTES = 64 * 1024;

const resolveEncryptionKey = () => {
  const raw = String(config.partnerCredentials.encryptionKey || "").trim();
  if (!raw) {
    throw new ApiError(
      503,
      "Partner credential encryption is not configured",
    );
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32 && base64.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) {
    return base64;
  }

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;

  throw new ApiError(
    503,
    "PARTNER_CREDENTIAL_ENCRYPTION_KEY must be 32 UTF-8 bytes, 64 hex characters, or a base64-encoded 32-byte key",
  );
};

const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

const sanitizeCredentialValue = (value: unknown, depth = 0): unknown => {
  if (depth > 12) throw new ApiError(400, "credentials exceed the nesting limit");
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCredentialValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        if (unsafeObjectKeys.has(key)) {
          throw new ApiError(400, `Credential key '${key}' is not allowed`);
        }
        return [key, sanitizeCredentialValue(child, depth + 1)];
      }),
    );
  }
  return value;
};

const assertPlainObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "credentials must be a JSON object");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (_error) {
    throw new ApiError(400, "credentials must be valid JSON data");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_CREDENTIAL_BYTES) {
    throw new ApiError(400, "credentials exceed the 64 KB limit");
  }
  return sanitizeCredentialValue(JSON.parse(serialized)) as Record<
    string,
    unknown
  >;
};

const hasCredentialValue = (
  credentials: Record<string, unknown>,
  keys: string[],
) =>
  keys.some((key) => {
    const value = credentials[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });

export const validatePartnerCredentialPayload = (
  authType: PartnerCredentialAuthType,
  value: unknown,
) => {
  const credentials = assertPlainObject(value);
  const credentialKeys = Object.keys(credentials)
    .filter((key) => key && !unsafeObjectKeys.has(key))
    .sort();

  if (authType === PartnerCredentialAuthType.API_KEY && !hasCredentialValue(credentials, ["apiKey", "api_key", "key", "token"])) {
    throw new ApiError(400, "API key authentication requires an apiKey or token credential");
  }
  if (authType === PartnerCredentialAuthType.BASIC && (!hasCredentialValue(credentials, ["username", "user"]) || !hasCredentialValue(credentials, ["password", "pass"]))) {
    throw new ApiError(400, "Basic authentication requires username and password credentials");
  }
  if (authType === PartnerCredentialAuthType.BEARER && !hasCredentialValue(credentials, ["token", "accessToken", "access_token"])) {
    throw new ApiError(400, "Bearer authentication requires a token credential");
  }
  if (authType === PartnerCredentialAuthType.OAUTH2 && (!hasCredentialValue(credentials, ["clientId", "client_id"]) || !hasCredentialValue(credentials, ["clientSecret", "client_secret"]))) {
    throw new ApiError(400, "OAuth2 authentication requires clientId and clientSecret credentials");
  }
  if (authType === PartnerCredentialAuthType.CUSTOM && credentialKeys.length === 0) {
    throw new ApiError(400, "Custom authentication requires at least one credential");
  }

  return { credentials, credentialKeys };
};

export const encryptPartnerCredentials = (
  credentials: Record<string, unknown>,
): EncryptedPartnerCredentials => {
  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);

  return {
    version: 1,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
};

export const decryptPartnerCredentials = (
  encrypted: EncryptedPartnerCredentials,
): Record<string, unknown> => {
  if (!encrypted || encrypted.version !== 1) {
    throw new ApiError(500, "Unsupported partner credential encryption version");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      resolveEncryptionKey(),
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return assertPlainObject(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Partner credentials could not be decrypted");
  }
};

const maskSecret = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(maskSecret);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        maskSecret(child),
      ]),
    );
  }
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  return text.length <= 4 ? "••••••" : `••••${text.slice(-4)}`;
};

export const maskPartnerCredentials = (credentials: Record<string, unknown>) =>
  maskSecret(credentials) as Record<string, unknown>;

const isPrivateIpv4 = (ip: string) => {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isFinite(part))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
};

const isPrivateIp = (ip: string) => {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    if (net.isIPv4(mappedIpv4)) return isPrivateIpv4(mappedIpv4);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
};

const validateConnectivityUrl = async (rawUrl: string) => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (_error) {
    throw new ApiError(400, "Partner baseUrl must be a valid URL");
  }
  if (url.username || url.password) {
    throw new ApiError(400, "Partner baseUrl cannot contain embedded credentials");
  }
  const allowedProtocols = config.partnerCredentials.allowHttpTest
    ? ["https:", "http:"]
    : ["https:"];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new ApiError(400, "Partner connectivity tests require an HTTPS URL");
  }
  if (url.hostname.toLowerCase() === "localhost") {
    throw new ApiError(400, "Local partner API hosts are not allowed");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = net.isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await dns.lookup(url.hostname, { all: true });
  } catch (_error) {
    throw new ApiError(400, "Partner API host could not be resolved");
  }
  if (!addresses.length) throw new ApiError(400, "Partner API host did not resolve");
  if (
    !config.partnerCredentials.allowPrivateNetworkTest &&
    addresses.some(({ address }) => isPrivateIp(address))
  ) {
    throw new ApiError(400, "Private or local partner API hosts are not allowed");
  }
  return url.toString();
};

export const testPartnerConnectivity = async (baseUrl: string) => {
  const safeUrl = await validateConnectivityUrl(baseUrl);
  const startedAt = Date.now();
  try {
    const response = await axios.request({
      method: "HEAD",
      url: safeUrl,
      timeout: config.partnerCredentials.testTimeoutMs,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: { "User-Agent": "Fintaraa-Partner-Health/1.0" },
    });
    return {
      reachable: true,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
      message: `Partner host responded with HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      reachable: false,
      statusCode: error?.response?.status,
      latencyMs: Date.now() - startedAt,
      message: error?.code
        ? `Partner host could not be reached (${String(error.code)})`
        : "Partner host could not be reached",
    };
  }
};
