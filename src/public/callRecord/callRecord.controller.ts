import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CallRecord } from "../../modals/callRecord.model";

type MatchMode = "phone_and_recording" | "phone" | "recording" | "none";

type CallRecordLookup = {
  phoneNumber: string;
  recordingUrl: string;
  normalizedPhoneDigits: string;
  matchedBy: MatchMode;
  record: any | null;
};

const normalizePhoneDigits = (input?: string): string =>
  String(input || "").replace(/\D/g, "");

const escapeHtml = (value: any): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeRegex = (value: string): string =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatDate = (value?: string | Date | null) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatMoney = (value: any) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Not available";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

const displayValue = (value: any) => {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }

  if (value instanceof Date) return formatDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const buildPhoneFilter = (phoneNumber: string) => {
  const digits = normalizePhoneDigits(phoneNumber);
  if (!digits) return null;

  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  const candidates = Array.from(
    new Set(
      [
        phoneNumber.trim(),
        digits,
        last10,
        `+91${last10}`,
        `91${last10}`,
        `0${last10}`,
      ].filter(Boolean),
    ),
  );

  return {
    $or: [
      { phoneNumber: { $in: candidates } },
      {
        phoneNumber: {
          $regex: new RegExp(`${escapeRegex(last10)}$`, "i"),
        },
      },
    ],
  };
};

const buildRecordingFilter = (recordingUrl: string) => {
  const trimmed = String(recordingUrl || "").trim();
  if (!trimmed) return null;

  return {
    recordingUrl: {
      $regex: new RegExp(escapeRegex(trimmed), "i"),
    },
  };
};

const resolveLookup = async (req: Request): Promise<CallRecordLookup> => {
  const phoneNumber = String(req.query.phone_number || "").trim();
  const recordingUrl = String(req.query.recording_url || "").trim();
  const normalizedPhoneDigits = normalizePhoneDigits(phoneNumber);

  if (!phoneNumber) {
    throw new ApiError(
      400,
      "phone_number is required to open the call record page",
    );
  }

  const phoneFilter = buildPhoneFilter(phoneNumber);
  const recordingFilter = buildRecordingFilter(recordingUrl);
  let record: any | null = null;
  let matchedBy: MatchMode = "none";

  if (phoneFilter && recordingFilter) {
    record = await CallRecord.findOne({
      $and: [phoneFilter, recordingFilter],
    })
      .sort({ createdAt: -1 })
      .lean();
    if (record) matchedBy = "phone_and_recording";
  }

  if (!record && phoneFilter) {
    record = await CallRecord.findOne(phoneFilter)
      .sort({ createdAt: -1 })
      .lean();
    if (record) matchedBy = "phone";
  }

  if (!record && recordingFilter) {
    record = await CallRecord.findOne(recordingFilter)
      .sort({ createdAt: -1 })
      .lean();
    if (record) matchedBy = "recording";
  }

  return {
    phoneNumber,
    recordingUrl,
    normalizedPhoneDigits,
    matchedBy,
    record,
  };
};

const renderField = (label: string, value: any, highlight = false) => `
  <div class="field ${highlight ? "field--highlight" : ""}">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${escapeHtml(displayValue(value))}</div>
  </div>
`;

const buildPageHtml = (lookup: CallRecordLookup) => {
  const { phoneNumber, recordingUrl, record, matchedBy } = lookup;
  const resolvedRecordingUrl = String(record?.recordingUrl || recordingUrl || "");
  const hasRecording = Boolean(
    resolvedRecordingUrl && !resolvedRecordingUrl.includes("@"),
  );
  const hasRecord = Boolean(record);

  const summaryText = hasRecord
    ? "A matching call record was found from the public lookup."
    : "No matching call record was found. The page still shows the IVR request details.";

  const details = hasRecord
    ? [
        ["Phone Number", record.phoneNumber, true],
        ["Call Status", record.callStatus],
        ["Follow Up", record.followUp],
        ["Product Service", record.productService],
        ["Loan Amount", formatMoney(record.loanAmount)],
        ["Callback At", formatDate(record.callbackAt)],
        ["Lead Status", record.leadStatus],
        ["City", record.city],
        ["State", record.state],
        ["Pincode", record.pincode],
        ["Assignee", record.assignee],
        ["Assigned At", formatDate(record.assignedAt)],
        ["Data Source", record.dataSource],
        ["Comment", record.comment],
        ["Created At", formatDate(record.createdAt)],
        ["Updated At", formatDate(record.updatedAt)],
      ]
    : [];

  const visibleDetails = details.filter(([, value]) => displayValue(value) !== "Not available");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Call Record</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --panel: rgba(255, 255, 255, 0.94);
      --panel-border: rgba(17, 24, 39, 0.08);
      --text: #102033;
      --muted: #667085;
      --brand: #0f766e;
      --brand-soft: rgba(15, 118, 110, 0.12);
      --warning: #9a3412;
      --shadow: 0 18px 50px rgba(16, 32, 51, 0.12);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 28%),
        radial-gradient(circle at top right, rgba(2, 132, 199, 0.08), transparent 24%),
        var(--bg);
      color: var(--text);
    }

    .shell {
      width: min(1100px, calc(100% - 24px));
      margin: 0 auto;
      padding: 20px 0 32px;
    }

    .hero {
      display: grid;
      gap: 8px;
      padding: 20px;
      margin-bottom: 16px;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 20px;
      box-shadow: var(--shadow);
    }

    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 12px;
      color: var(--brand);
      font-weight: 700;
    }

    h1 {
      margin: 0;
      font-size: clamp(26px, 4vw, 38px);
      line-height: 1.1;
    }

    .subline {
      margin: 0;
      color: var(--muted);
      max-width: 72ch;
      line-height: 1.5;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--brand-soft);
      color: var(--brand);
      font-size: 13px;
      font-weight: 600;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      gap: 16px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 20px;
      box-shadow: var(--shadow);
      padding: 18px;
      overflow: hidden;
    }

    .card h2 {
      margin: 0 0 6px;
      font-size: 18px;
    }

    .card p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
    }

    .stack {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .field {
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.03);
      border: 1px solid rgba(15, 23, 42, 0.05);
    }

    .field--highlight {
      background: rgba(15, 118, 110, 0.1);
      border-color: rgba(15, 118, 110, 0.18);
    }

    .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      margin-bottom: 5px;
      font-weight: 700;
    }

    .value {
      font-size: 15px;
      line-height: 1.45;
      word-break: break-word;
    }

    .recording {
      display: grid;
      gap: 12px;
    }

    .audio-shell {
      padding: 16px;
      border-radius: 18px;
      background: rgba(15, 118, 110, 0.06);
      border: 1px solid rgba(15, 118, 110, 0.16);
    }

    audio {
      width: 100%;
    }

    .link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--brand);
      text-decoration: none;
      font-weight: 600;
      word-break: break-all;
    }

    .status {
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(154, 52, 18, 0.08);
      color: var(--warning);
      border: 1px solid rgba(154, 52, 18, 0.16);
      line-height: 1.5;
    }

    .footer {
      margin-top: 16px;
      color: var(--muted);
      font-size: 13px;
    }

    @media (max-width: 860px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">Public Call Record</div>
      <h1>Call Record Lookup</h1>
      <p class="subline">${escapeHtml(summaryText)}</p>
      <div class="chips">
        <span class="chip">Phone: ${escapeHtml(phoneNumber)}</span>
        <span class="chip">Recording: ${hasRecording ? "Available" : "Not available"}</span>
        <span class="chip">Match: ${escapeHtml(matchedBy)}</span>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <h2>IVR Request</h2>
        <p>Values received from the iframe URL.</p>
        <div class="stack">
          ${renderField("Phone Number", phoneNumber, true)}
          ${renderField("Recording URL", recordingUrl)}
          ${renderField("Normalized Digits", lookup.normalizedPhoneDigits)}
        </div>
        <div class="footer">
          API endpoint: <code>/api/public/call-records</code>
        </div>
      </article>

      <article class="card">
        <h2>Matched Record</h2>
        <p>${hasRecord ? "The latest matching record is shown below." : "No record matched this request."}</p>
        <div class="stack">
          ${
            hasRecord
              ? visibleDetails
                  .map(([label, value, highlight]) =>
                    renderField(label, value, Boolean(highlight)),
                  )
                  .join("")
              : `
                <div class="status">
                  No call record was found for the supplied phone number and recording URL.
                  If this is an IVR test, confirm the parameters are being substituted before the URL is opened.
                </div>
              `
          }
        </div>
      </article>
    </section>

    <section class="card" style="margin-top:16px;">
      <h2>Recording Preview</h2>
      <p>Use this section to inspect the call audio directly in the iframe.</p>
      <div class="stack">
        ${
          hasRecording
            ? `
              <div class="audio-shell">
                <audio controls preload="none" src="${escapeHtml(
                  resolvedRecordingUrl,
                )}"></audio>
              </div>
              <a class="link" href="${escapeHtml(
                resolvedRecordingUrl,
              )}" target="_blank" rel="noopener noreferrer">
                Open recording URL
              </a>
            `
            : `
              <div class="status">
                Recording URL was not supplied or appears to be a placeholder.
              </div>
            `
        }
      </div>
    </section>
  </div>
</body>
</html>`;
};

const setIframeHeaders = (res: Response) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' https: data: blob:",
      "base-uri 'self'",
      "frame-ancestors *",
      "img-src 'self' https: data: blob:",
      "media-src 'self' https: data: blob:",
      "style-src 'self' 'unsafe-inline'",
    ].join("; "),
  );
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
};

export class PublicCallRecordController {
  static async getLookup(req: Request, res: Response, next: NextFunction) {
    try {
      const lookup = await resolveLookup(req);
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            {
              query: {
                phone_number: lookup.phoneNumber,
                recording_url: lookup.recordingUrl,
              },
              match: {
                found: Boolean(lookup.record),
                matchedBy: lookup.matchedBy,
                record: lookup.record,
              },
            },
            "Call record lookup fetched successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async renderIframePage(req: Request, res: Response, next: NextFunction) {
    try {
      const lookup = await resolveLookup(req);
      setIframeHeaders(res);
      return res.status(200).type("html").send(buildPageHtml(lookup));
    } catch (error) {
      if (error instanceof ApiError) {
        setIframeHeaders(res);
        const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Call Record</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f6f7fb;
      color: #102033;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 20px;
    }
    .box {
      width: min(640px, 100%);
      padding: 20px;
      border-radius: 18px;
      background: #fff;
      border: 1px solid rgba(16, 32, 51, 0.08);
      box-shadow: 0 18px 50px rgba(16, 32, 51, 0.12);
    }
    .title {
      margin: 0 0 10px;
      font-size: 24px;
    }
    .text {
      margin: 0;
      color: #667085;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1 class="title">Call Record Lookup</h1>
    <p class="text">${escapeHtml(error.message)}</p>
  </div>
</body>
</html>`;
        return res.status(error.statusCode || 400).type("html").send(html);
      }

      next(error);
    }
  }
}
