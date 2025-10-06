import "colors";
import path from "path";
import cors from "cors";
import colors from "colors";
import helmet from "helmet";
import express from "express";
import routes from "./routes";
import cookieParser from "cookie-parser";
import { logger } from "./config/logger";
import { config } from "./config/config";
import { ipBlocker } from "./config/ipBlocker";
import { limiter } from "./middlewares/limiter";
import { corsOptions } from "./middlewares/corsMiddleware";
import { notFoundHandler } from "./middlewares/notFounHandler";
import { globalErrorHandler } from "./middlewares/errorHandler";

const app = express();

app.use(ipBlocker);
app.use(cookieParser());

// Middleware
app.use(helmet());
if (config.cors.enabled) app.use(cors(corsOptions));
else console.log("⚠️  CORS is disabled by config");

if (config.security.rateLimitEnabled) {
  app.set("trust proxy", 1);
  app.use(limiter);
  console.log("✅ Rate limiter enabled");
}

// Middleware for parsing JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging Middleware
import mongoose from "mongoose";

// Add to your global middleware stack
app.use(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  (req as any).mongoSession = session;

  const startTime = process.hrtime();

  res.on("finish", async () => {
    const diff = process.hrtime(startTime);
    const responseTime = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);

    const fetchStatus = () => {
      if (res.statusCode >= 500) return colors.red(`${res.statusCode}`);
      if (res.statusCode >= 400) return colors.yellow(`${res.statusCode}`);
      if (res.statusCode >= 300) return colors.cyan(`${res.statusCode}`);
      if (res.statusCode >= 200) return colors.green(`${res.statusCode}`);
      return colors.white(`${res.statusCode}`);
    };

    // ✅ Auto-commit transaction for 2xx responses
    try {
      if (res.statusCode >= 200 && res.statusCode < 400)
        await session.commitTransaction();
      else await session.abortTransaction();
    } catch (err) {
      console.log("❌ Error finalizing transaction:", err);
    } finally {
      session.endSession();
    }

    logger.info(
      `${"METHOD:".blue} ${req.method.yellow} - ${"URL:".blue} ${req.originalUrl.yellow
      } - ${"STATUS:".blue} ${fetchStatus()} - ${"Response Time:".blue} ${responseTime.magenta
      } ${"ms".magenta}`
    );
  });
  next();
});

// Handle Public API Routes
app.use("/api", routes);

// Handle Get Images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Handle 404 errors
app.use(notFoundHandler);

// Handle global errors
app.use(globalErrorHandler);

export default app;
