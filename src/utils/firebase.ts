import path from "path";
import { readFileSync } from "fs";
import admin from "firebase-admin";

try {
  if (!admin.apps.length) {
    const serviceAccountPath = path.join(
      __dirname,
      "../config/firebase-service-account.json"
    );

    const serviceAccount = JSON.parse(
      readFileSync(serviceAccountPath, "utf-8")
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("✅ Firebase Admin initialized successfully");
  }
} catch (error) {
  // console.log("❌ Firebase Admin initialization failed:", error);
  // process.exit(1); // exit app if Firebase can't initialize properly
}

export default admin;
