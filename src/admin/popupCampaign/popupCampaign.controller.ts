import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import sanitizeHtml from "sanitize-html";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  IPopupCampaign,
  PopupCampaign,
  PopupCampaignStatus,
  PopupContentType,
  PopupFieldType,
  PopupFrequency,
  PopupTriggerType,
  PopupType,
} from "../../modals/popupCampaign.model";
import { PopupSubmission } from "../../modals/popupSubmission.model";
import {
  DEFAULT_QUERY_TIMEZONE,
  parseDateInTimeZone,
} from "../../utils/helper";
import { leadManagementService } from "../../services/leadManagement.service";

const formPopupTypes = new Set<PopupType>([
  PopupType.LEAD_CAPTURE,
  PopupType.SURVEY,
]);
const sensitiveQueryKeys = new Set([
  "token",
  "access_token",
  "refresh_token",
  "otp",
  "code",
  "mobile",
  "phone",
  "email",
  "pan",
  "aadhaar",
  "password",
]);

const clean = (value: unknown, max = 240) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const cleanMultiline = (value: unknown, max = 4000) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);

const asBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  }
  return fallback;
};

const asNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
};

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
) => {
  const parsed = clean(value, 80) as T;
  return values.includes(parsed) ? parsed : fallback;
};

const parseArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const targetPages = (value: unknown) => {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // Newline/comma input is accepted for admin convenience.
          }
          return value.split(/[\n,]+/);
        })()
      : [];
  const unique = Array.from(
    new Set(
      candidates
        .map((item) => clean(item, 300))
        .filter((item) => item === "*" || item.startsWith("/")),
    ),
  ).slice(0, 100);
  return unique.length ? unique : ["*"];
};

const safeActionUrl = (value: unknown) => {
  const url = clean(value, 1200);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
};

const safeImageUrl = (value: unknown) => {
  const url = clean(value, 1200);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
};

const safePageUrl = (value: unknown) => {
  const raw = clean(value, 1600);
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://fintaraa.invalid");
    Array.from(parsed.searchParams.keys()).forEach((key) => {
      if (sensitiveQueryKeys.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    });
    if (parsed.origin === "https://fintaraa.invalid") {
      return `${parsed.pathname}${parsed.search}`.slice(0, 1200);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return `${parsed.origin}${parsed.pathname}${parsed.search}`.slice(0, 1200);
  } catch {
    return "";
  }
};

const safeAttributionParams = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | string[]> = {};
  Object.entries(value as Record<string, unknown>)
    .slice(0, 60)
    .forEach(([rawKey, rawValue]) => {
      const key = clean(rawKey, 100);
      if (!key || sensitiveQueryKeys.has(key.toLowerCase())) return;
      const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
        .map((item) => clean(item, 500))
        .filter(Boolean)
        .slice(0, 10);
      if (!values.length) return;
      result[key] = values.length === 1 ? values[0] : values;
    });
  return result;
};

const normaliseAttribution = (value: unknown) => {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    source: clean(raw.source, 120) || "direct",
    medium: clean(raw.medium, 120),
    campaign: clean(raw.campaign, 160),
    term: clean(raw.term, 160),
    content: clean(raw.content, 160),
    referrer: safePageUrl(raw.referrer),
    landingPage: safePageUrl(raw.landingPage),
    queryParams: safeAttributionParams(raw.queryParams),
    gclid: clean(raw.gclid, 240),
    fbclid: clean(raw.fbclid, 240),
    dsaReferralCode: clean(raw.dsaReferralCode, 40),
    capturedAt: clean(raw.capturedAt, 80),
    lastTouchPage: safePageUrl(raw.lastTouchPage),
    lastTouchQueryParams: safeAttributionParams(raw.lastTouchQueryParams),
    lastTouchAt: clean(raw.lastTouchAt, 80),
  };
};

const sanitiseHtmlContent = (value: unknown) =>
  sanitizeHtml(cleanMultiline(value, 50_000), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h1",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "span",
      "div",
      "hr",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "style"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb(a)?\([\d\s,.%]+\)$/i],
        "background-color": [
          /^#[0-9a-f]{3,8}$/i,
          /^rgb(a)?\([\d\s,.%]+\)$/i,
        ],
        "text-align": [/^(left|right|center|justify)$/],
        "font-size": [/^\d{1,3}(px|rem|em|%)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "line-height": [/^\d+(\.\d+)?(px|rem|em|%)?$/],
        margin: [/^[\d\s.%a-z-]+$/i],
        padding: [/^[\d\s.%a-z-]+$/i],
        "border-radius": [/^[\d\s.%a-z-]+$/i],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: "noopener noreferrer",
          ...(attribs.target === "_blank" ? { target: "_blank" } : {}),
        },
      }),
    },
  });

const normaliseFormFields = (value: unknown) => {
  const names = new Set<string>();
  return parseArray(value)
    .slice(0, 20)
    .map((raw: any, index) => {
      const generatedName = `field_${index + 1}`;
      let name = clean(raw?.name, 50)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^([^a-z])/, "f_$1")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      if (!name) name = generatedName;
      if (names.has(name)) {
        throw new ApiError(400, `Duplicate popup field name: ${name}`);
      }
      names.add(name);
      const type = enumValue(
        raw?.type,
        Object.values(PopupFieldType),
        PopupFieldType.TEXT,
      );
      const options = Array.from(
        new Set(
          (Array.isArray(raw?.options)
            ? raw.options
            : String(raw?.options || "").split(/[\n,]+/)
          )
            .map((item: unknown) => clean(item, 100))
            .filter(Boolean),
        ),
      ).slice(0, 30);
      if (
        [PopupFieldType.SELECT, PopupFieldType.RADIO].includes(type) &&
        !options.length
      ) {
        throw new ApiError(400, `${raw?.label || name} needs options`);
      }
      return {
        name,
        label: clean(raw?.label, 100) || `Field ${index + 1}`,
        type,
        required: asBoolean(raw?.required, false),
        placeholder: clean(raw?.placeholder, 180),
        options,
      };
    });
};

const parsedDate = (
  value: unknown,
  fallback: Date | undefined,
  label: string,
) => {
  if (value === undefined) return fallback;
  if (value === null || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${label} is not a valid date`);
  }
  return date;
};

const normaliseCampaignPayload = (
  body: Record<string, any>,
  existing?: IPopupCampaign,
) => {
  const previous = existing?.toObject() || {};
  const pick = (key: string) =>
    body[key] !== undefined ? body[key] : (previous as any)[key];
  const popupType = enumValue(
    pick("popupType"),
    Object.values(PopupType),
    PopupType.OFFER_ANNOUNCEMENT,
  );
  const contentType = enumValue(
    pick("contentType"),
    Object.values(PopupContentType),
    PopupContentType.IMAGE,
  );
  const imageUrl = safeImageUrl(pick("imageUrl"));
  const mobileImageUrl = safeImageUrl(pick("mobileImageUrl"));
  const htmlContent = sanitiseHtmlContent(pick("htmlContent"));
  const formFields = normaliseFormFields(pick("formFields"));
  const startsAt = parsedDate(
    body.startsAt,
    existing?.startsAt,
    "Campaign start",
  );
  const endsAt = parsedDate(body.endsAt, existing?.endsAt, "Campaign end");

  if (!clean(pick("name"), 140)) {
    throw new ApiError(400, "Popup campaign name is required");
  }
  if (contentType === PopupContentType.IMAGE && !imageUrl) {
    throw new ApiError(400, "Upload an image for image popup content");
  }
  if (contentType === PopupContentType.HTML && !htmlContent) {
    throw new ApiError(400, "HTML popup content is required");
  }
  if (formPopupTypes.has(popupType) && !formFields.length) {
    throw new ApiError(400, "Lead capture and survey popups need form fields");
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new ApiError(400, "Campaign end must be after campaign start");
  }

  return {
    name: clean(pick("name"), 140),
    popupType,
    contentType,
    heading: clean(pick("heading"), 180),
    description: cleanMultiline(pick("description"), 1200),
    imageUrl,
    mobileImageUrl,
    imageAlt: clean(pick("imageAlt"), 180),
    htmlContent,
    ctaText: clean(pick("ctaText"), 80),
    ctaUrl: safeActionUrl(pick("ctaUrl")),
    triggerType: enumValue(
      pick("triggerType"),
      Object.values(PopupTriggerType),
      PopupTriggerType.PAGE_LOAD,
    ),
    delaySeconds: asNumber(pick("delaySeconds"), 5, 1, 3600),
    scrollPercentage: asNumber(pick("scrollPercentage"), 50, 5, 100),
    targetPages: targetPages(pick("targetPages")),
    frequency: enumValue(
      pick("frequency"),
      Object.values(PopupFrequency),
      PopupFrequency.ONCE_PER_SESSION,
    ),
    formFields: formPopupTypes.has(popupType) ? formFields : [],
    submitButtonText: clean(pick("submitButtonText"), 80) || "Submit",
    successMessage:
      clean(pick("successMessage"), 500) ||
      "Thank you. We have received your response.",
    priority: asNumber(pick("priority"), 100, 1, 10000),
    dismissible: asBoolean(pick("dismissible"), true),
    status: enumValue(
      pick("status"),
      Object.values(PopupCampaignStatus),
      PopupCampaignStatus.INACTIVE,
    ),
    startsAt,
    endsAt,
  };
};

const normalisePath = (value: unknown) => {
  const supplied = clean(value, 800);
  if (!supplied) return "/";
  try {
    const parsed = new URL(supplied, "https://fintaraa.invalid");
    return parsed.pathname.replace(/\/+/g, "/") || "/";
  } catch {
    return supplied.startsWith("/") ? supplied.split("?")[0] : "/";
  }
};

const targetMatches = (path: string, patterns: string[]) =>
  patterns.some((pattern) => {
    if (pattern === "*") return true;
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    try {
      return new RegExp(`^${escaped}/?$`, "i").test(path);
    } catch {
      return false;
    }
  });

const activeCampaignMatch = (now = new Date()) => ({
  status: PopupCampaignStatus.ACTIVE,
  $and: [
    { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
  ],
});

const requestLocation = (req: Request) => ({
  city: clean(
    req.get("cf-ipcity") ||
      req.get("x-vercel-ip-city") ||
      req.get("x-appengine-city"),
    100,
  ),
  region: clean(
    req.get("cf-region") ||
      req.get("x-vercel-ip-country-region") ||
      req.get("x-appengine-region"),
    100,
  ),
  country: clean(
    req.get("cf-ipcountry") ||
      req.get("x-vercel-ip-country") ||
      req.get("x-appengine-country"),
    100,
  ),
});

const clientIp = (req: Request) =>
  clean(
    req.get("cf-connecting-ip") ||
      req.get("x-real-ip") ||
      String(req.get("x-forwarded-for") || "").split(",")[0] ||
      req.socket.remoteAddress,
    100,
  );

const normaliseSubmissionValues = (
  rawValues: unknown,
  campaign: IPopupCampaign,
) => {
  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
    throw new ApiError(400, "Popup form values are required");
  }
  const source = rawValues as Record<string, unknown>;
  const values: Record<string, string | number | boolean> = {};

  campaign.formFields.forEach((field) => {
    const raw = source[field.name];
    const isEmpty =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && !raw.trim()) ||
      (field.type === PopupFieldType.CHECKBOX &&
        !asBoolean(raw, false));
    if (field.required && isEmpty) {
      throw new ApiError(400, `${field.label} is required`);
    }
    if (isEmpty) return;

    if (field.type === PopupFieldType.CHECKBOX) {
      values[field.name] = asBoolean(raw, false);
      return;
    }
    if (field.type === PopupFieldType.NUMBER) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new ApiError(400, `${field.label} must be a number`);
      }
      values[field.name] = parsed;
      return;
    }
    if (field.type === PopupFieldType.RATING) {
      const rating = Number(raw);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ApiError(400, `${field.label} must be rated from 1 to 5`);
      }
      values[field.name] = rating;
      return;
    }

    const value = cleanMultiline(
      raw,
      field.type === PopupFieldType.TEXTAREA ? 4000 : 500,
    );
    if (
      field.type === PopupFieldType.EMAIL &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      throw new ApiError(400, `${field.label} must be a valid email`);
    }
    if (
      field.type === PopupFieldType.TEL &&
      !/^\+?[\d\s()-]{7,20}$/.test(value)
    ) {
      throw new ApiError(400, `${field.label} must be a valid phone number`);
    }
    if (
      [PopupFieldType.SELECT, PopupFieldType.RADIO].includes(field.type) &&
      !(field.options || []).includes(value)
    ) {
      throw new ApiError(400, `${field.label} contains an invalid option`);
    }
    values[field.name] = value;
  });
  return values;
};

const contactValue = (
  values: Record<string, string | number | boolean>,
  patterns: RegExp[],
) => {
  const key = Object.keys(values).find((item) =>
    patterns.some((pattern) => pattern.test(item)),
  );
  return key ? clean(values[key], 240) : "";
};

const dateRangeMatch = (startDate: unknown, endDate: unknown) => {
  const createdAt: Record<string, Date> = {};
  if (typeof startDate === "string" && startDate) {
    const parsed = parseDateInTimeZone(
      startDate,
      "start",
      DEFAULT_QUERY_TIMEZONE,
    );
    if (parsed) createdAt.$gte = parsed;
  }
  if (typeof endDate === "string" && endDate) {
    const parsed = parseDateInTimeZone(
      endDate,
      "end",
      DEFAULT_QUERY_TIMEZONE,
    );
    if (parsed) createdAt.$lte = parsed;
  }
  return Object.keys(createdAt).length ? { createdAt } : {};
};

export class PopupCampaignController {
  static async publicList(req: Request, res: Response, next: NextFunction) {
    try {
      const pagePath = normalisePath(req.query.path);
      const rows = await PopupCampaign.find(activeCampaignMatch())
        .sort({ priority: 1, createdAt: -1 })
        .limit(50)
        .select(
          "name popupType contentType heading description imageUrl mobileImageUrl imageAlt htmlContent ctaText ctaUrl triggerType delaySeconds scrollPercentage targetPages frequency formFields submitButtonText successMessage priority dismissible",
        )
        .lean();
      const result = rows
        .filter((row) => targetMatches(pagePath, row.targetPages || ["*"]))
        .slice(0, 10);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Active popups fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async submit(req: Request | any, res: Response, next: NextFunction) {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json(new ApiError(400, "Invalid popup ID"));
      }
      const campaign = await PopupCampaign.findOne({
        _id: req.params.id,
        ...activeCampaignMatch(),
      });
      if (!campaign || !formPopupTypes.has(campaign.popupType)) {
        return res
          .status(404)
          .json(new ApiError(404, "Popup form is not available"));
      }
      const sourcePage = normalisePath(req.body?.sourcePage);
      if (!targetMatches(sourcePage, campaign.targetPages || ["*"])) {
        return res
          .status(400)
          .json(new ApiError(400, "Popup is not targeted to this page"));
      }
      const values = normaliseSubmissionValues(req.body?.values, campaign);
      const attribution = normaliseAttribution(req.body?.attribution);
      const location = requestLocation(req);
      const ip = clientIp(req);
      const result = await PopupSubmission.create({
        popup: campaign._id,
        popupName: campaign.name,
        popupType: campaign.popupType,
        values,
        contactName: contactValue(values, [/^name$/i, /full_?name/i]),
        email: contactValue(values, [/email/i]),
        mobile: contactValue(values, [/mobile/i, /phone/i, /contact/i]),
        sourcePage,
        pageUrl: safePageUrl(req.body?.pageUrl),
        sessionId: clean(req.body?.sessionId, 100),
        visitorId: clean(req.body?.visitorId, 100),
        user: req.user?._id,
        deviceType: ["mobile", "tablet", "desktop"].includes(
          clean(req.body?.deviceType, 20),
        )
          ? clean(req.body?.deviceType, 20)
          : "unknown",
        ...location,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        term: attribution.term,
        content: attribution.content,
        referrer: attribution.referrer,
        landingPage: attribution.landingPage,
        queryParams: attribution.queryParams,
        gclid: attribution.gclid,
        fbclid: attribution.fbclid,
        dsaReferralCode: attribution.dsaReferralCode,
        attribution,
        metadata: {
          userAgent: clean(req.get("user-agent"), 500),
          ipHash: ip
            ? crypto
                .createHash("sha256")
                .update(`${process.env.JWT_SECRET || "fintaraa"}:${ip}`)
                .digest("hex")
                .slice(0, 24)
            : undefined,
        },
      });
      if (result.mobile && campaign.popupType === PopupType.LEAD_CAPTURE) {
        try {
          await leadManagementService.captureLead(
            {
              fullName: result.contactName || "Website popup lead",
              email: result.email,
              mobile: result.mobile,
              whatsappOptIn: asBoolean(
                values.whatsappConsent ?? values.whatsappOptIn,
                false,
              ),
              tags: ["website_popup", campaign.name],
              utmSource: attribution.source,
              utmMedium: attribution.medium,
              utmCampaign: attribution.campaign,
              utmTerm: attribution.term,
              utmContent: attribution.content,
              landingPage: attribution.landingPage || result.pageUrl,
              campaignId: attribution.campaign,
              attribution,
              queryParams: attribution.queryParams,
              gclid: attribution.gclid,
              fbclid: attribution.fbclid,
              dsaReferralCode: attribution.dsaReferralCode,
            },
            {
              source: "website",
              channel: "popup_lead_capture",
              externalId: String(result._id),
              actorId: req.user?._id ? String(req.user._id) : undefined,
              skipExternalNotifications: true,
              metadata: {
                popupId: String(campaign._id),
                popupSubmissionId: String(result._id),
              },
            },
          );
        } catch (leadError: any) {
          console.error(
            "[Lead Sync] Popup lead sync failed:",
            leadError?.message || leadError,
          );
        }
      }
      return res.status(201).json(
        new ApiResponse(
          201,
          { submissionId: result._id },
          campaign.successMessage,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async adminList(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const match: Record<string, any> = {};
      const status = clean(req.query.status, 40);
      const popupType = clean(req.query.popupType, 60);
      const search = clean(req.query.search, 140);
      if (Object.values(PopupCampaignStatus).includes(status as any)) {
        match.status = status;
      }
      if (Object.values(PopupType).includes(popupType as any)) {
        match.popupType = popupType;
      }
      if (search) match.name = { $regex: search, $options: "i" };

      const [rows, total, active, totalSubmissions] = await Promise.all([
        PopupCampaign.find(match)
          .sort({ priority: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        PopupCampaign.countDocuments(match),
        PopupCampaign.countDocuments({
          ...match,
          status: PopupCampaignStatus.ACTIVE,
        }),
        PopupSubmission.countDocuments(),
      ]);
      const ids = rows.map((row) => row._id);
      const grouped = ids.length
        ? await PopupSubmission.aggregate([
            { $match: { popup: { $in: ids } } },
            { $group: { _id: "$popup", count: { $sum: 1 } } },
          ])
        : [];
      const counts = new Map(
        grouped.map((item) => [String(item._id), Number(item.count)]),
      );
      return res.status(200).json(
        new ApiResponse(200, {
          items: rows.map((row) => ({
            ...row,
            submissionCount: counts.get(String(row._id)) || 0,
          })),
          summary: { total, active, totalSubmissions },
          pagination: {
            currentPage: page,
            itemsPerPage: limit,
            totalItems: total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const payload = normaliseCampaignPayload(req.body || {});
      const result = await PopupCampaign.create({
        ...payload,
        createdBy: req.user?._id,
        updatedBy: req.user?._id,
      });
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Popup campaign created"));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request | any, res: Response, next: NextFunction) {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json(new ApiError(400, "Invalid popup ID"));
      }
      const campaign = await PopupCampaign.findById(req.params.id);
      if (!campaign) {
        return res
          .status(404)
          .json(new ApiError(404, "Popup campaign not found"));
      }
      const payload = normaliseCampaignPayload(req.body || {}, campaign);
      campaign.set({ ...payload, updatedBy: req.user?._id });
      await campaign.save();
      return res
        .status(200)
        .json(new ApiResponse(200, campaign, "Popup campaign updated"));
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json(new ApiError(400, "Invalid popup ID"));
      }
      const result = await PopupCampaign.findByIdAndDelete(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Popup campaign not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Popup campaign deleted"));
    } catch (error) {
      next(error);
    }
  }

  static async submissions(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const match: Record<string, any> = {
        ...dateRangeMatch(req.query.startDate, req.query.endDate),
      };
      const popupId = clean(req.query.popupId, 60);
      const popupType = clean(req.query.popupType, 60);
      const sourcePage = clean(req.query.sourcePage, 800);
      const search = clean(req.query.search, 180);
      if (popupId && Types.ObjectId.isValid(popupId)) {
        match.popup = new Types.ObjectId(popupId);
      }
      if (Object.values(PopupType).includes(popupType as any)) {
        match.popupType = popupType;
      }
      if (sourcePage) match.sourcePage = sourcePage;
      if (search) {
        match.$or = [
          { popupName: { $regex: search, $options: "i" } },
          { contactName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } },
          { sourcePage: { $regex: search, $options: "i" } },
        ];
      }
      const [items, total] = await Promise.all([
        PopupSubmission.find(match)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        PopupSubmission.countDocuments(match),
      ]);
      return res.status(200).json(
        new ApiResponse(200, {
          items,
          pagination: {
            currentPage: page,
            itemsPerPage: limit,
            totalItems: total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  }
}
