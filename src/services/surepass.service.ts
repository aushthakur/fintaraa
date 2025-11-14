import axios, { AxiosError } from "axios";
import ApiError from "../utils/ApiError";
import { config } from "../config/config";

type SurepassEnvironment = "sandbox" | "production";

interface SurepassEnvConfig {
  baseUrl: string;
  token: string;
}

export interface SurepassCibilRequestPayload {
  mobile: string;
  pan: string;
  name: string;
  gender: "male" | "female";
  consent: string;
}

export interface SurepassCibilInput
  extends Partial<SurepassCibilRequestPayload> {
  mobileNumber?: string;
  phoneNumber?: string;
  contactNumber?: string;
  panCard?: string;
  panNumber?: string;
  pancard?: string;
}

const sanitizeNumber = (value: string) => value.replace(/\D/g, "");

const sanitizePan = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const normalizeGender = (value: string) => value.trim().toLowerCase();

const normalizeConsent = (value: string) => value.trim().toLowerCase();

const ensureEnvConfig = (
  env: SurepassEnvironment
): SurepassEnvConfig & { environment: SurepassEnvironment } => {
  const targetEnv = env === "production" ? "production" : "sandbox";
  const envConfig =
    targetEnv === "production"
      ? config.surepass.production
      : config.surepass.sandbox;

  if (!envConfig?.token) {
    throw new ApiError(
      500,
      `Surepass token is not configured for ${targetEnv} environment`
    );
  }

  return {
    ...envConfig,
    environment: targetEnv,
  };
};

export const prepareSurepassCibilPayload = (
  input: SurepassCibilInput
): SurepassCibilRequestPayload => {
  const mobileCandidate =
    input.mobile ||
    input.mobileNumber ||
    input.phoneNumber ||
    input.contactNumber;

  const panCandidate =
    input.pan || input.panCard || input.panNumber || input.pancard;

  if (!mobileCandidate) {
    throw new ApiError(
      400,
      "Mobile number is required to fetch the CIBIL report"
    );
  }

  if (!panCandidate) {
    throw new ApiError(400, "PAN number is required to fetch the CIBIL report");
  }

  if (!input.name) {
    throw new ApiError(400, "Full name is required to fetch the CIBIL report");
  }

  if (!input.gender) {
    throw new ApiError(400, "Gender is required to fetch the CIBIL report");
  }

  if (!input.consent) {
    throw new ApiError(
      400,
      "Customer consent is required to fetch the CIBIL report"
    );
  }

  const mobile = sanitizeNumber(String(mobileCandidate));
  if (mobile.length < 10) {
    throw new ApiError(400, "Mobile number should be at least 10 digits");
  }

  const pan = sanitizePan(String(panCandidate));
  if (pan.length < 5) {
    throw new ApiError(400, "PAN number appears to be invalid");
  }

  const gender = normalizeGender(String(input.gender)) as "male" | "female";
  if (!["male", "female"].includes(gender)) {
    throw new ApiError(400, "Gender must be either 'male' or 'female'");
  }

  const consent = normalizeConsent(String(input.consent));

  return {
    mobile,
    pan,
    name: String(input.name).trim(),
    gender,
    consent,
  };
};

export const fetchSurepassCibilReport = async (
  payload: SurepassCibilRequestPayload,
  options?: { environment?: SurepassEnvironment }
) => {
  const environment =
    options?.environment ||
    (config.surepass.environment === "production" ? "production" : "sandbox");

  const envConfig = ensureEnvConfig(environment);

  try {
    const url = `${envConfig.baseUrl}${config.surepass.endpoints.cibil}`;
    payload = { ...payload, consent: "Y" };
    console.log("first", payload, envConfig, url);
    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${envConfig.token}`,
        "Content-Type": "application/json",
      },
      timeout: config.surepass.timeoutMs,
    });

    return {
      environment: envConfig.environment,
      data,
    };
  } catch (error) {
    const err = error as AxiosError<any>;
    const status = err.response?.status || 500;
    const message =
      (err.response?.data as any)?.message ||
      (err.response?.data as any)?.error ||
      err.message ||
      "Failed to fetch CIBIL report";
    throw new ApiError(status, message, err.response?.data);
  }
};
