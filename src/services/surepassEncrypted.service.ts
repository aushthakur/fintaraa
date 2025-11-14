import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios, { AxiosError } from "axios";
import ApiError from "../utils/ApiError";
import { config } from "../config/config";
import {
  SurepassCibilInput,
  SurepassCibilRequestPayload,
  prepareSurepassCibilPayload,
} from "./surepass.service";

const resolveKey = (filePath: string) => {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new ApiError(
      500,
      `Surepass encrypted key missing at ${absolutePath}. Please verify the path.`
    );
  }
  return fs.readFileSync(absolutePath);
};

let cachedPrivateKey: Buffer | null = null;
let cachedPublicKey: Buffer | null = null;

const getPrivateKey = () => {
  if (!cachedPrivateKey) {
    cachedPrivateKey = resolveKey(
      (config as any).surepassEncrypted.privateKeyPath
    );
  }
  return cachedPrivateKey;
};

const getPublicKey = () => {
  if (!cachedPublicKey) {
    cachedPublicKey = resolveKey(
      (config as any).surepassEncrypted.publicKeyPath
    );
  }
  return cachedPublicKey;
};

const encryptPayload = (payload: string) => {
  const aesKey = crypto.randomBytes(32); // AES-256
  const iv = crypto.randomBytes(12); // Recommended IV size for GCM

  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const encryptedAesKey = crypto.publicEncrypt(
    {
      key: getPublicKey(),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey
  );

  return [
    encryptedAesKey.toString("base64"),
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
};

const decryptPayload = (encryptedPayload: string) => {
  const [encryptedAesKeyB64, ivB64, dataB64, authTagB64] =
    encryptedPayload.split(":");

  if (!encryptedAesKeyB64 || !ivB64 || !dataB64 || !authTagB64) {
    throw new ApiError(500, "Malformed encrypted response from Surepass");
  }

  const aesKey = crypto.privateDecrypt(
    {
      key: getPrivateKey(),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encryptedAesKeyB64, "base64")
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    aesKey,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

const makeEncryptedRequest = async (
  endpoint: string,
  payload: SurepassCibilRequestPayload | Record<string, any>
) => {
  const { surepassEncrypted }: any = config;
  if (!surepassEncrypted.token || !surepassEncrypted.clientId) {
    throw new ApiError(
      500,
      "Surepass encrypted credentials are not configured. Please check the .env file."
    );
  }

  const jsonPayload = JSON.stringify(payload);
  const encryptedPayload = encryptPayload(jsonPayload);

  try {
    const response = await axios.post(
      `${surepassEncrypted.baseUrl}${endpoint}`,
      encryptedPayload,
      {
        headers: {
          Authorization: `Bearer ${surepassEncrypted.token}`,
          "x-client-id": surepassEncrypted.clientId,
          "Content-Type": "text/plain",
          "x-content-type": "application/json",
          "x-content-length": Buffer.byteLength(jsonPayload).toString(),
        },
        timeout: config.surepass.timeoutMs,
      }
    );

    const decryptedResponse = decryptPayload(response.data);
    return JSON.parse(decryptedResponse);
  } catch (error) {
    const err = error as AxiosError;
    const message =
      (err.response?.data as any)?.message ||
      err.message ||
      "Failed to fetch encrypted CIBIL report";
    const status = err.response?.status || 500;
    throw new ApiError(status, message, err.response?.data);
  }
};

export const fetchEncryptedCibilReport = async (input: SurepassCibilInput) => {
  const payload = prepareSurepassCibilPayload(input);
  const response = await makeEncryptedRequest(
    config.surepass.endpoints.cibil,
    payload
  );
  return {
    payload,
    response,
  };
};
