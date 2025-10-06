import "colors";
import app from "./app";
import { config } from "dotenv";
import { createServer } from "http";
import { logger } from "./config/logger";
import connectDB from "./config/database";
import { Server as HttpServer } from "http";
import { watchEnvFile } from "./config/envWatcher";
import { configureSocket } from "./config/socket.io";
import { config as manualConfig } from "./config/config"

// Load environment variables
config();
watchEnvFile();

const port = manualConfig.port;
const dbUrl = manualConfig.db.url;

// Validate necessary environment variables
if (!port || !dbUrl) {
  logger.error("Missing required environment variables. Exiting...");
  process.exit(1);
}

// Create HTTP server from Express app
const httpServer: HttpServer = createServer(app);

// Initialize Socket.IO with the HTTP server
configureSocket(httpServer, app);

// Graceful shutdown
const shutdown = (): void => {
  logger.info("Shutting down the server...");
  httpServer.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });

  // Force shutdown after 10 seconds if it doesn't shut down properly
  setTimeout(() => {
    logger.error("Forcing shutdown after timeout.");
    process.exit(1);
  }, 10000).unref(); // Prevent blocking the event loop
};

// Handle unexpected errors
process.on("uncaughtException", (err: Error) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1); // Exit the process to avoid inconsistent state
});

process.on("unhandledRejection", (reason: any) => {
  logger.error(`Unhandled Promise Rejection: ${reason}`);
  process.exit(1); // Exit the process to avoid inconsistent state
});

// Gracefully handle SIGTERM and SIGINT signals
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Connect to the database and start the server
const startServer = async (): Promise<void> => {
  try {
    await connectDB(); // Establish database connection
    httpServer.listen(port, () => {
      logger.info(
        `Server is running at http://localhost:${port}`.blue,
      );
    });
  } catch (err: any) {
    logger.error(`Failed to start the server: ${err.message}`);
    process.exit(1);
  }
};

startServer();
