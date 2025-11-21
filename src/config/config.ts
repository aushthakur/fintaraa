import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const toBool = (value: string | undefined): boolean => value === "true";

export const config = {
  env: process.env.NODE_ENV || "production",
  port: Number(process.env.PORT) || 8080,
  baseUrl: process.env.APP_BASE_URL!,
  frontendUrl: process.env.FRONTEND_URL!,
  surepass: {
    environment: process.env.SUREPASS_ENVIRONMENT || "sandbox",
    timeoutMs: Number(process.env.SUREPASS_TIMEOUT_MS || 10000),
    sandbox: {
      baseUrl:
        process.env.SUREPASS_SANDBOX_BASE_URL || "https://sandbox.surepass.app",
      token: process.env.SUREPASS_SANDBOX_TOKEN || "",
    },
    production: {
      baseUrl:
        process.env.SUREPASS_PRODUCTION_BASE_URL ||
        "https://kyc-api.surepass.app",
      token: process.env.SUREPASS_PRODUCTION_TOKEN || "",
    },
    endpoints: {
      cibil: "/api/v1/credit-report-cibil/fetch-report",
    },
  },

  cors: {
    enabled: toBool(process.env.CORS_ENABLED),
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || [],
  },

  db: {
    url: process.env.DB_URL!,
    name: process.env.DB_NAME!,
  },

  jwt: {
    maxAge: Number(process.env.MAX_AGE!) || 7,
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    refreshSecret: process.env.REFRESH_TOKEN_SECRET!,
    refreshExpiresIn: process.env.REFRESH_EXPIRES_IN || "7d",
  },

  email: {
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    user: process.env.EMAIL_USER,
    from: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
    secure: toBool(process.env.EMAIL_SECURE),
  },

  initAdmin: {
    enabled: toBool(process.env.INIT_ADMIN),
    name: process.env.ADMIN_NAME!,
    email: process.env.ADMIN_EMAIL!,
    password: process.env.ADMIN_PASSWORD!,
  },

  sms: {
    enabled: toBool(process.env.SMS_ENABLED),
    provider: process.env.SMS_PROVIDER!,
    twilio: {
      sid: process.env.TWILIO_ACCOUNT_SID!,
      authToken: process.env.TWILIO_AUTH_TOKEN!,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
    },
  },

  notification: {
    enabled: toBool(process.env.NOTIFICATION_ENABLED),
    provider: process.env.NOTIFICATION_PROVIDER!,
    firebase: {
      serverKey: process.env.FIREBASE_SERVER_KEY!,
      projectId: process.env.FIREBASE_PROJECT_ID!,
    },
  },

  payment: {
    enabled: toBool(process.env.PAYMENT_ENABLED),
    gateway: process.env.PAYMENT_GATEWAY!,
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID!,
      keySecret: process.env.RAZORPAY_KEY_SECRET!,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET!,
    },
    razorpayX: {
      accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || "",
      keyId: process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID!,
      keySecret:
        process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET!,
      webhookSecret: process.env.RAZORPAYX_WEBHOOK_SECRET || "",
      contactType: process.env.RAZORPAYX_CONTACT_TYPE || "employee",
    },
  },

  integrations: {
    inboundWebhookKey: process.env.LEAD_WEBHOOK_KEY || "",
    allowedSources:
      process.env.LEAD_ALLOWED_SOURCES?.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean) ||
      [
        "meta_ads",
        "google_ads",
        "landing_page",
        "affiliate",
        "zapier",
        "manual",
      ],
    zapier: {
      signingSecret: process.env.ZAPIER_SIGNING_SECRET || "",
      webhookKey: process.env.ZAPIER_WEBHOOK_KEY || "",
    },
    ads: {
      metaVerifyToken: process.env.META_LEAD_VERIFY_TOKEN || "",
      googleLeadKey: process.env.GOOGLE_LEAD_KEY || "",
    },
  },

  s3: {
    region: process.env.S3_REGION!,
    bucket: process.env.S3_BUCKET!,
    baseUrl: process.env.S3_BASE_URL!,
    enabled: toBool(process.env.S3_ENABLED),
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },

  security: {
    ips: process.env.BLOCKED_IPS?.split(",") || [],
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 100),
    rateLimitEnabled: toBool(process.env.RATE_LIMIT_ENABLED),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  },
};
