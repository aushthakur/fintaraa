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

export interface SurepassCibilInput extends Partial<SurepassCibilRequestPayload> {
  mobileNumber?: string;
  phoneNumber?: string;
  contactNumber?: string;
  panCard?: string;
  panNumber?: string;
  pancard?: string;
}

export interface SurepassRcRequestPayload {
  id_number: string;
  enrich: boolean;
}

export interface SurepassRcInput {
  id_number?: string;
  idNumber?: string;
  carNumber?: string;
  vehicleNumber?: string;
  enrich?: boolean;
}

const sanitizeNumber = (value: string) => value.replace(/\D/g, "");

const sanitizePan = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const sanitizeRcNumber = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const normalizeGender = (value: string) => value.trim().toLowerCase();

const normalizeConsent = (value: string) => value.trim().toLowerCase();

const ensureEnvConfig = (
  env: SurepassEnvironment,
): SurepassEnvConfig & { environment: SurepassEnvironment } => {
  const targetEnv = env === "production" ? "production" : "sandbox";
  const envConfig =
    targetEnv === "production"
      ? config.surepass.production
      : config.surepass.sandbox;

  if (!envConfig?.token) {
    throw new ApiError(
      500,
      `Surepass token is not configured for ${targetEnv} environment`,
    );
  }

  return {
    ...envConfig,
    environment: targetEnv,
  };
};

export const prepareSurepassCibilPayload = (
  input: SurepassCibilInput,
): SurepassCibilRequestPayload => {
  const mobileCandidate =
    input.mobile ||
    input.mobileNumber ||
    input.phoneNumber ||
    input.contactNumber;

  const panCandidate =
    input.pan || input.panCard || input.panNumber || input.pancard;
  const name = String(input.name || "").trim();
  const consent = normalizeConsent(String(input.consent || ""));

  if (!mobileCandidate) {
    throw new ApiError(
      400,
      "Mobile number is required to fetch the CIBIL report",
    );
  }

  if (!panCandidate) {
    throw new ApiError(400, "PAN number is required to fetch the CIBIL report");
  }

  if (!name) {
    throw new ApiError(400, "Full name is required to fetch the CIBIL report");
  }

  if (!input.gender) {
    throw new ApiError(400, "Gender is required to fetch the CIBIL report");
  }

  if (!consent) {
    throw new ApiError(
      400,
      "Customer consent is required to fetch the CIBIL report",
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

  return {
    mobile,
    pan,
    name,
    gender,
    consent,
  };
};

export const fetchSurepassCibilReport = async (
  payload: SurepassCibilRequestPayload,
  options?: { environment?: SurepassEnvironment },
) => {
  const environment =
    options?.environment ||
    (config.surepass.environment === "production" ? "production" : "sandbox");

  const envConfig = ensureEnvConfig(environment);

  try {
    const url = `${envConfig.baseUrl}${config.surepass.endpoints.cibil}`;
    payload = { ...payload, consent: "Y" };
    // console.log(payload, envConfig, url);
    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${envConfig.token}`,
        "Content-Type": "application/json",
      },
      timeout: config.surepass.timeoutMs,
    });

    console.log(data);

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

export const fetchSurepassCibilPdfReport = async (
  payload: SurepassCibilRequestPayload,
  options?: { environment?: SurepassEnvironment },
) => {
  const environment =
    options?.environment ||
    (config.surepass.environment === "production" ? "production" : "sandbox");

  const envConfig = ensureEnvConfig(environment);

  try {
    const url = `${envConfig.baseUrl}${config.surepass.endpoints.cibilPdf}`;
    payload = { ...payload, consent: "Y" };

    console.log(url, payload);
    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${envConfig.token}`,
        "Content-Type": "application/json",
      },
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
      "Failed to fetch CIBIL PDF report";
    throw new ApiError(status, message, err.response?.data);
  }
};

export const prepareSurepassRcPayload = (
  input: SurepassRcInput,
): SurepassRcRequestPayload => {
  const candidate =
    input.id_number || input.idNumber || input.carNumber || input.vehicleNumber;

  if (!candidate) {
    throw new ApiError(400, "Car registration number is required");
  }

  const id_number = sanitizeRcNumber(String(candidate));
  if (id_number.length < 6) {
    throw new ApiError(400, "Car registration number appears to be invalid");
  }

  return {
    id_number,
    enrich: input.enrich !== false,
  };
};

export const fetchSurepassRcDetails = async (
  payload: SurepassRcRequestPayload,
  options?: { environment?: SurepassEnvironment },
) => {
  const environment =
    options?.environment ||
    (config.surepass.environment === "production" ? "production" : "sandbox");

  const envConfig = ensureEnvConfig(environment);

  try {
    const url = `${envConfig.baseUrl}${config.surepass.endpoints.rcV2}`;
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
      "Failed to fetch RC details";
    throw new ApiError(status, message, err.response?.data);
  }
};
