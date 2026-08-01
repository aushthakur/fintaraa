import { ClientSession } from "mongoose";
import { ConsentHistory } from "../modals/consentHistory.model";

export const APPLICATION_COMMUNICATION_CONSENT_TEXT =
  "I agree that Fintaraa may contact me on WhatsApp, call, SMS, or email for my request, application updates, document support, and service communication.";

const EXTERNAL_APPLICATION_SOURCES = new Set([
  "app",
  "b2c_app",
  "b2b_app",
  "website",
]);

const EXTERNAL_APPLICATION_ROLES = new Set([
  "user",
  "agency",
  "agency_member",
]);

export const parseConsentBoolean = (value: unknown) =>
  value === true ||
  value === 1 ||
  ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());

export const parseCommunicationConsent = (
  value: unknown,
): Record<string, any> => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) };
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

export const normalizeApplicationCommunicationConsent = ({
  whatsappConsent,
  communicationConsent,
  source,
  formSource,
}: {
  whatsappConsent?: unknown;
  communicationConsent?: unknown;
  source?: unknown;
  formSource?: unknown;
}) => {
  const details = parseCommunicationConsent(communicationConsent);
  const whatsapp =
    parseConsentBoolean(whatsappConsent) ||
    parseConsentBoolean(details.whatsapp);
  const normalizedSource = String(
    details.source || source || details.platform || "unknown",
  )
    .trim()
    .toLowerCase();
  const normalizedFormSource = String(
    details.formSource || formSource || normalizedSource,
  )
    .trim()
    .toLowerCase();
  const rawCollectedAt = details.consentedAt || details.collectedAt;
  const parsedCollectedAt = rawCollectedAt ? new Date(rawCollectedAt) : null;
  const consentedAt =
    whatsapp && parsedCollectedAt && !Number.isNaN(parsedCollectedAt.getTime())
      ? parsedCollectedAt.toISOString()
      : whatsapp
        ? new Date().toISOString()
        : undefined;

  return {
    whatsapp,
    details: {
      ...details,
      whatsapp,
      call: parseConsentBoolean(details.call),
      sms: parseConsentBoolean(details.sms),
      email: parseConsentBoolean(details.email),
      consentText:
        String(details.consentText || "").trim() ||
        APPLICATION_COMMUNICATION_CONSENT_TEXT,
      consentedAt,
      source: normalizedSource,
      platform: String(details.platform || normalizedSource).trim().toLowerCase(),
      formSource: normalizedFormSource,
    },
  };
};

export const requiresApplicationWhatsappConsent = ({
  status,
  source,
  formSource,
  role,
}: {
  status?: unknown;
  source?: unknown;
  formSource?: unknown;
  role?: unknown;
}) => {
  if (String(status || "").trim().toLowerCase() === "draft") return false;
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (["admin", "agent", "lander"].includes(normalizedRole)) return false;
  // The authenticated actor is authoritative. Do not allow an app/website
  // client to bypass mandatory consent by omitting or spoofing dataSource.
  if (EXTERNAL_APPLICATION_ROLES.has(normalizedRole)) return true;
  const candidates = [source, formSource]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return candidates.some(
    (value) =>
      EXTERNAL_APPLICATION_SOURCES.has(value) ||
      value.startsWith("b2c_") ||
      value.startsWith("b2b_") ||
      value.startsWith("website_"),
  );
};

export type CommunicationConsentActorModel = "User" | "Agency";

export const resolveConsentActorModel = (
  role?: unknown,
): CommunicationConsentActorModel =>
  ["agency", "agency_member"].includes(
    String(role || "").trim().toLowerCase(),
  )
    ? "Agency"
    : "User";

export const recordCommunicationConsentAudit = async ({
  actorId,
  actorRole,
  referenceId,
  purpose,
  source,
  formSource,
  communicationConsent,
  ipAddress,
  userAgent,
  session,
  metadata,
}: {
  actorId: string;
  actorRole?: string;
  referenceId: string;
  purpose: string;
  source?: string;
  formSource?: string;
  communicationConsent: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  session?: ClientSession;
  metadata?: Record<string, any>;
}) => {
  const actorModel = resolveConsentActorModel(actorRole);
  const grantedScopes = ["whatsapp", "call", "sms", "email"].filter(
    (scope) => communicationConsent?.[scope] === true,
  );
  const collectedAtValue = communicationConsent?.consentedAt
    ? new Date(communicationConsent.consentedAt)
    : new Date();
  const collectedAt = Number.isNaN(collectedAtValue.getTime())
    ? new Date()
    : collectedAtValue;
  const channel = String(source || "").toLowerCase().includes("website")
    ? "web"
    : "app";

  return ConsentHistory.findOneAndUpdate(
    {
      user: actorId,
      actorModel,
      purpose,
      referenceId,
      status: "granted",
    },
    {
      $setOnInsert: {
        user: actorId,
        actorModel,
        actorRole: String(actorRole || "").trim().toLowerCase(),
        type: "other",
        purpose,
        scope: grantedScopes,
        channel,
        referenceId,
        status: "granted",
        collectedAt,
        ipAddress,
        userAgent,
        metadata: {
          source,
          formSource,
          consentText:
            communicationConsent?.consentText ||
            APPLICATION_COMMUNICATION_CONSENT_TEXT,
          communicationConsent,
          ...(metadata || {}),
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, session },
  );
};
