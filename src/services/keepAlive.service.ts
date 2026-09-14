import { logger } from "../config/logger";
import { config as manualConfig } from "../config/config";

export interface KeepAliveTargetResult {
  url: string;
  success: boolean;
  statusCode?: number;
  durationMs: number;
  error?: string;
  checkedAt: string;
}

export interface KeepAliveStatus {
  enabled: boolean;
  intervalMs: number;
  intervalMinutes: number;
  running: boolean;
  totalPings: number;
  lastPingAt?: string;
  lastResults: KeepAliveTargetResult[];
  targets: string[];
}

// 3 minutes in milliseconds as requested
const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;
const intervalMs = Number(process.env.KEEP_ALIVE_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
const isEnabled = process.env.KEEP_ALIVE_ENABLED !== "false";

let timer: NodeJS.Timeout | null = null;
let initialTimeout: NodeJS.Timeout | null = null;
let isPinging = false;
let totalPingsCount = 0;
let lastPingTime: string | undefined = undefined;
let lastPingResults: KeepAliveTargetResult[] = [];

/**
 * Resolve target URLs for keep-alive.
 * Prioritizes Render environment variables, production domains, and configured URLs.
 */
export const getKeepAliveTargetUrls = (): string[] => {
  const urlSet = new Set<string>();

  // 1. Explicitly configured custom URLs (comma-separated)
  if (process.env.KEEP_ALIVE_URLS) {
    process.env.KEEP_ALIVE_URLS.split(",")
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((u) => urlSet.add(u));
  }

  // 2. Render External URL (Render automatically provides RENDER_EXTERNAL_URL for web services)
  if (process.env.RENDER_EXTERNAL_URL) {
    const renderUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
    urlSet.add(`${renderUrl}/health`);
  }

  // 3. Backend explicit keep-alive URL or base URL
  if (process.env.BACKEND_KEEP_ALIVE_URL) {
    urlSet.add(process.env.BACKEND_KEEP_ALIVE_URL.trim());
  } else if (manualConfig.baseUrl) {
    const backendBase = manualConfig.baseUrl.replace(/\/+$/, "");
    urlSet.add(`${backendBase}/health`);
  }

  // 4. Frontend Website keep-alive URL
  if (process.env.FRONTEND_KEEP_ALIVE_URL) {
    urlSet.add(process.env.FRONTEND_KEEP_ALIVE_URL.trim());
  } else if (manualConfig.publicWebsiteUrl) {
    const websiteBase = manualConfig.publicWebsiteUrl.replace(/\/+$/, "");
    urlSet.add(`${websiteBase}/api/health`);
  }

  // 5. Admin portal keep-alive URL (if separate on Render)
  if (process.env.ADMIN_KEEP_ALIVE_URL) {
    urlSet.add(process.env.ADMIN_KEEP_ALIVE_URL.trim());
  } else if (manualConfig.frontendUrl) {
    const adminBase = manualConfig.frontendUrl.replace(/\/+$/, "");
    urlSet.add(`${adminBase}/api/health`);
  }

  // 6. Local fallback if no public URL was registered
  if (urlSet.size === 0) {
    const port = manualConfig.port || 5000;
    urlSet.add(`http://localhost:${port}/health`);
  }

  return Array.from(urlSet);
};

/**
 * Pings a single target URL with strict timeout and zero memory retention.
 */
const pingTarget = async (url: string): Promise<KeepAliveTargetResult> => {
  const startTime = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 second strict timeout

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "FintaraaKeepAlive/1.0 (Render Keep-Alive)",
        "Cache-Control": "no-cache, no-store",
        Accept: "application/json, text/plain, */*",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    // Drain body quickly so connection is cleanly returned
    await response.text().catch(() => {});

    const durationMs = Date.now() - startTime;
    return {
      url,
      success: response.ok,
      statusCode: response.status,
      durationMs,
      checkedAt,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error?.name === "AbortError" ? "Timeout after 8s" : error?.message || "Unknown error";
    return {
      url,
      success: false,
      durationMs,
      error: errorMsg,
      checkedAt,
    };
  }
};

/**
 * Execute a single round of keep-alive pings across all configured targets.
 * Includes a 500ms stagger between requests to prevent any load spikes on Render.
 */
export const triggerKeepAlivePing = async (): Promise<{
  timestamp: string;
  total: number;
  successful: number;
  results: KeepAliveTargetResult[];
}> => {
  if (isPinging) {
    return {
      timestamp: new Date().toISOString(),
      total: lastPingResults.length,
      successful: lastPingResults.filter((r) => r.success).length,
      results: lastPingResults,
    };
  }

  isPinging = true;
  const targets = getKeepAliveTargetUrls();
  const results: KeepAliveTargetResult[] = [];

  try {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const result = await pingTarget(target);
      results.push(result);

      // Stagger consecutive pings by 500ms to eliminate simultaneous spikes
      if (i < targets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    totalPingsCount += 1;
    lastPingTime = new Date().toISOString();
    lastPingResults = results;

    const successfulCount = results.filter((r) => r.success).length;
    logger.info(
      `[KeepAlive] 3-minute ping completed: ${successfulCount}/${targets.length} targets active (Targets: ${targets
        .map((t) => t.replace(/^https?:\/\//, ""))
        .join(", ")})`
    );

    return {
      timestamp: lastPingTime,
      total: targets.length,
      successful: successfulCount,
      results,
    };
  } catch (err: any) {
    logger.error(`[KeepAlive] Unexpected error during keep-alive run: ${err.message}`);
    return {
      timestamp: new Date().toISOString(),
      total: targets.length,
      successful: 0,
      results,
    };
  } finally {
    isPinging = false;
  }
};

/**
 * Returns current status and telemetry of keep-alive worker.
 */
export const getKeepAliveStatus = (): KeepAliveStatus => {
  return {
    enabled: isEnabled,
    intervalMs,
    intervalMinutes: intervalMs / (60 * 1000),
    running: timer !== null,
    totalPings: totalPingsCount,
    lastPingAt: lastPingTime,
    lastResults: lastPingResults,
    targets: getKeepAliveTargetUrls(),
  };
};

/**
 * Start keep-alive worker to ping targets every 3 minutes.
 */
export const startKeepAliveWorker = (): void => {
  if (!isEnabled) {
    logger.info("[KeepAlive] Service is disabled via KEEP_ALIVE_ENABLED=false.");
    return;
  }

  if (timer) {
    logger.info("[KeepAlive] Worker is already running.");
    return;
  }

  const minutes = (intervalMs / (60 * 1000)).toFixed(1);
  logger.info(`[KeepAlive] Starting Render keep-alive scheduler (Interval: ${minutes} minutes)`);

  // Initial warm-up ping after 15 seconds so startup completes smoothly
  initialTimeout = setTimeout(() => {
    triggerKeepAlivePing().catch(() => {});
  }, 15000);

  // Recurring 3-minute ping
  timer = setInterval(() => {
    triggerKeepAlivePing().catch(() => {});
  }, intervalMs);

  if (timer.unref) {
    timer.unref(); // Prevent timer from blocking process exit
  }
};

/**
 * Stop keep-alive worker gracefully.
 */
export const stopKeepAliveWorker = (): void => {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("[KeepAlive] Worker stopped.");
  }
};
