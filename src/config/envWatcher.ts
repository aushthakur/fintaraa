import fs from "fs";
import dotenv from "dotenv";

let currentEnv: NodeJS.ProcessEnv = process.env;

export const loadEnv = () => {
  const result = dotenv.config();
  if (result.error) {
    console.log("Failed to load .env:", result.error);
    return;
  }
  console.log("✅ .env reloaded at", new Date().toLocaleTimeString());
  currentEnv = { ...process.env };
};

export const watchEnvFile = () => {
  const envPath = ".env";
  if (!fs.existsSync(envPath)) {
    console.log(".env file not found.");
    return;
  }

  loadEnv();

  fs.watch(envPath, (eventType) => {
    if (eventType === "change") loadEnv();
  });
  console.log("👀 Watching .env for changes...");
};
