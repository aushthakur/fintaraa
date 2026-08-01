import path from "path";
import { existsSync, readFileSync } from "fs";
import admin from "firebase-admin";

const parseServiceAccount = () => {
  const inline = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (inline) {
    const decoded = inline.startsWith("{")
      ? inline
      : Buffer.from(inline, "base64").toString("utf8");
    return JSON.parse(decoded);
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, "../config/firebase-service-account.json");
  if (!existsSync(serviceAccountPath)) return null;
  return JSON.parse(readFileSync(serviceAccountPath, "utf-8"));
};

try {
  if (!admin.apps.length) {
    const serviceAccount = parseServiceAccount();
    const isServiceAccount = Boolean(
      serviceAccount?.project_id &&
        serviceAccount?.client_email &&
        serviceAccount?.private_key,
    );

    if (isServiceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("✅ Firebase Admin initialized successfully");
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || undefined,
      });
      console.log("✅ Firebase Admin initialized with application credentials");
    } else if (!serviceAccount) {
      console.log(
        "[Firebase] Service account not found. FCM push is disabled until server credentials are configured.",
      );
    } else {
      console.log(
        "[Firebase] Config file is a client google-services file, not a Firebase Admin service account. FCM server sending is disabled.",
      );
    }
  }
} catch (error: any) {
  console.log(
    `[Firebase] Admin initialization failed: ${error?.message || error}`,
  );
}

export default admin;
