import "colors";
import figlet from "figlet";
import mongoose from "mongoose";
import { logger } from "./logger";
import { config } from "./config";
import { config as envConfig } from "dotenv";
import { MongoClient, ServerApiVersion } from "mongodb";
import { createDefaultAdmin } from "../utils/createDefaultAdmin";

envConfig();

const connectDB = async () => {
  try {
    const dbURL = config.db.url;
    const dbName = config.db.name;

    if (!dbURL || !dbName) {
      throw new Error("❌ Missing DB_URL or DB_NAME in configuration.");
    }

    const uri = `${dbURL}/${dbName}`;
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    try {
      await client.connect();
      await client.db(dbName).command({ ping: 1 });
      logger.info("Pinged MongoDB deployment successfully.".green);
    } finally {
      await client.close();
    }

    await mongoose.connect(uri);
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
