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

  dpo: {
    companyToken: process.env.DPO_COMPANY_TOKEN,
    apiUrl: process.env.DPO_API_URL || "https://secure.3gdirectpay.com/API/v6/",
    paymentBaseUrl:
      process.env.DPO_PAYMENT_BASE_URL ||
      "https://secure.3gdirectpay.com/payv2.php",
    timeoutMs: 10000,
    defaultCurrency: "USD",
  },

  pesapal: {
    publicKey: process.env.PESAPAL_PUBLIC_KEY,
    consumerKey: process.env.PESAPAL_CONSUMER_KEY,
    consumerSecret: process.env.PESAPAL_CONSUMER_SECRET,
    apiUrl: `${process.env.PESAPAL_TEST_URL}`,
    paymentUrl: `${process.env.PESAPAL_TEST_URL}`,
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
