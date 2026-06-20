import path from "path";
import { existsSync, readFileSync } from "fs";
import admin from "firebase-admin";

try {
  if (!admin.apps.length) {
    const serviceAccountPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      path.join(__dirname, "../config/firebase-service-account.json");

    if (!existsSync(serviceAccountPath)) {
      console.log(
        `[Firebase] Service account not found at ${serviceAccountPath}. FCM push disabled until it is added.`,
      );
    } else {
      const serviceAccount = JSON.parse(
        readFileSync(serviceAccountPath, "utf-8"),
      );

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      console.log("✅ Firebase Admin initialized successfully");
    }
  }
} catch (error: any) {
  console.log(
    `[Firebase] Admin initialization failed: ${error?.message || error}`,
  );
}

export default admin;
