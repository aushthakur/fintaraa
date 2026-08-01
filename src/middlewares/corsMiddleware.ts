import { CorsOptions } from "cors";
import { config } from "../config/config";

const normalizeOrigin = (value: unknown) => {
  const origin = String(value || "").trim().replace(/\/+$/, "");
  if (!origin) return "";

  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
};

const publicWebsiteOrigin = normalizeOrigin(config.publicWebsiteUrl);
const publicWebsiteWwwOrigin = (() => {
  if (!publicWebsiteOrigin) return "";

  try {
    const url = new URL(publicWebsiteOrigin);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
    } else {
      url.hostname = `www.${url.hostname}`;
    }
    return url.origin;
  } catch {
    return "";
  }
})();

const loopbackAliases = (origin: string) => {
  if (!origin) return [];
  try {
    const url = new URL(origin);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return [origin];
    const aliases = [origin];
    url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    aliases.push(url.origin);
    return aliases;
  } catch {
    return [origin];
  }
};

const allowedOrigins = new Set(
  [
    ...(config.cors.allowedOrigins || []),
    config.frontendUrl,
    publicWebsiteOrigin,
    publicWebsiteWwwOrigin,
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
    .flatMap(loopbackAliases),
);

export const corsOptions: CorsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin) {
      // Allow requests from mobile apps, Postman, curl, etc.
      return callback(null, true);
    }

    if (allowedOrigins.has(normalizeOrigin(origin))) {
      return callback(null, true);
    } else {
      console.log(`[CORS BLOCKED] Origin: ${origin}`);
      return callback(
        new Error(`CORS policy: Origin ${origin} is not allowed.`)
      );
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
  optionsSuccessStatus: 204,
};
