import "colors";
import figlet from "figlet";
import mongoose from "mongoose";
import { logger } from "./logger";
import { config } from "./config";
import { config as envConfig } from "dotenv";
import { createDefaultAdmin } from "../utils/createDefaultAdmin";

envConfig();

const connectDB = async () => {
  try {
    const dbURL = config.db.url;
    const dbName = config.db.name;

    if (!dbURL || !dbName) {
      throw new Error("❌ Missing DB_URL or DB_NAME in configuration.");
    }

    await mongoose.connect(`${dbURL}/${dbName}`);
    await createDefaultAdmin();

    figlet("Connected!", (err, data: any) => {
      if (err) {
        logger.warn("⚠️ Figlet rendering failed.");
        return;
      }
      logger.info(`\n${data.yellow}`);
      logger.info(`✅ MongoDB connected to ${dbName}`.green);
    });
  } catch (err: any) {
    logger.error(`❌ Database connection failed: ${err.message}`.red);
    process.exit(1);
  }
};

export default connectDB;
