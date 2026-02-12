import crypto from "crypto";

const ENCRYPTION_PREFIX = "enc:v1:";

const getKey = () => {
  const seed =
    process.env.QUERY_CHAT_ENCRYPTION_KEY ||
    process.env.DOC_PASSWORD_KEY ||
    process.env.JWT_SECRET ||
    "fintara-query-chat-fallback-key";
  return crypto.createHash("sha256").update(seed).digest();
};

export const encryptQueryMessageText = (plainText: string): string => {
  if (!plainText) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}.${tag.toString(
    "base64url",
  )}.${encrypted.toString("base64url")}`;
};

export const decryptQueryMessageText = (value: string): string => {
  if (!value) return "";
  if (!value.startsWith(ENCRYPTION_PREFIX)) return value;

  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return "";

  try {
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const encrypted = Buffer.from(dataB64, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return "";
  }
};

