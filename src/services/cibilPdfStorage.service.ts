import axios from "axios";
import { uploadObjectToS3 } from "../config/s3Uploader";
import ApiError from "../utils/ApiError";

const MAX_CIBIL_PDF_BYTES = 25 * 1024 * 1024;
const REPORT_LINK_KEYS = new Set([
  "creditreportlink",
  "pdfreportlink",
  "pdfurl",
  "reporturl",
]);

export interface StoredCibilPdf {
  provider: "fintaraa-s3";
  key: string;
  url: string;
  contentType: "application/pdf";
  size: number;
  storedAt: string;
}

export interface StoredCibilPdfReport {
  report: Record<string, any>;
  storage: StoredCibilPdf;
  uploaded: boolean;
}

const normalizeKey = (key: string) =>
  key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const findReportLink = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (REPORT_LINK_KEYS.has(normalizeKey(key)) && isHttpUrl(entry)) {
      return entry;
    }
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (entry && typeof entry === "object") {
      const nested = findReportLink(entry);
      if (nested) return nested;
    }
  }

  return null;
};

const findStorage = (value: unknown): StoredCibilPdf | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const candidate = record.fintaraaPdfStorage;
  if (
    candidate?.provider === "fintaraa-s3" &&
    typeof candidate?.key === "string" &&
    candidate.key.trim()
  ) {
    return candidate as StoredCibilPdf;
  }

  for (const entry of Object.values(record)) {
    if (entry && typeof entry === "object") {
      const nested = findStorage(entry);
      if (nested) return nested;
    }
  }

  return null;
};

const replaceProviderUrl = (
  value: unknown,
  providerUrl: string,
  storedUrl: string,
): unknown => {
  if (typeof value === "string") {
    return value === providerUrl ? storedUrl : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceProviderUrl(entry, providerUrl, storedUrl),
    );
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (REPORT_LINK_KEYS.has(normalizeKey(key)) && isHttpUrl(entry)) {
        return [key, storedUrl];
      }
      return [key, replaceProviderUrl(entry, providerUrl, storedUrl)];
    }),
  );
};

export const extractCibilPdfLink = (report: unknown) => findReportLink(report);

export const extractStoredCibilPdf = (report: unknown) => findStorage(report);

export const persistCibilPdfReport = async (
  report: unknown,
  options?: { environment?: string },
): Promise<StoredCibilPdfReport> => {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new ApiError(502, "CIBIL PDF response is invalid");
  }

  const existingStorage = findStorage(report);
  if (existingStorage) {
    return {
      report: report as Record<string, any>,
      storage: existingStorage,
      uploaded: false,
    };
  }

  const providerUrl = findReportLink(report);
  if (!providerUrl) {
    throw new ApiError(502, "CIBIL PDF link is unavailable");
  }

  let pdfBuffer: Buffer;
  try {
    const response = await axios.get<ArrayBuffer>(providerUrl, {
      responseType: "arraybuffer",
      timeout: 30_000,
      maxContentLength: MAX_CIBIL_PDF_BYTES,
      maxBodyLength: MAX_CIBIL_PDF_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    pdfBuffer = Buffer.from(response.data);
  } catch (error: any) {
    throw new ApiError(
      502,
      "CIBIL PDF source link is unavailable or has expired",
      error?.response?.data,
    );
  }

  if (
    !pdfBuffer.length ||
    pdfBuffer.length > MAX_CIBIL_PDF_BYTES ||
    pdfBuffer.subarray(0, 5).toString() !== "%PDF-"
  ) {
    throw new ApiError(502, "CIBIL provider did not return a valid PDF file");
  }

  const uploaded = await uploadObjectToS3(
    pdfBuffer,
    "cibil-report.pdf",
    "cibil-reports",
    {
      cacheControl: "private, no-store",
      contentDisposition: "attachment",
      metadata: {
        documentType: "cibil-report",
        ...(options?.environment
          ? { bureauEnvironment: options.environment }
          : {}),
      },
    },
  );
  const storage: StoredCibilPdf = {
    provider: "fintaraa-s3",
    key: uploaded.key,
    url: uploaded.url,
    contentType: "application/pdf",
    size: pdfBuffer.length,
    storedAt: new Date().toISOString(),
  };
  const sanitized = replaceProviderUrl(
    report,
    providerUrl,
    uploaded.url,
  ) as Record<string, any>;

  return {
    report: {
      ...sanitized,
      credit_report_link: uploaded.url,
      pdfUrl: uploaded.url,
      fintaraaPdfStorage: storage,
    },
    storage,
    uploaded: true,
  };
};
