import mongoose from "mongoose";
import { toBoolean } from "validator";
import { deleteFromS3 } from "../config/s3Uploader";

const { ObjectId } = mongoose.Types;
export const DEFAULT_QUERY_TIMEZONE = "Asia/Kolkata";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

const pad2 = (value: number) => String(value).padStart(2, "0");

const getTimeZoneParts = (date: Date, timeZone = DEFAULT_QUERY_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>(
    (acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    },
    {},
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const zonedTimeToUtc = (
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond?: number;
  },
  timeZone = DEFAULT_QUERY_TIMEZONE,
) => {
  let utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond ?? 0,
  );

  for (let i = 0; i < 2; i += 1) {
    const zonedParts = getTimeZoneParts(new Date(utcGuess), timeZone);
    const zonedAsUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second,
      parts.millisecond ?? 0,
    );
    const offset = zonedAsUtc - utcGuess;
    if (offset === 0) break;
    utcGuess -= offset;
  }

  return new Date(utcGuess);
};

export const formatDateInTimeZone = (
  date: Date,
  timeZone = DEFAULT_QUERY_TIMEZONE,
) => {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
};

export const parseDateInTimeZone = (
  value: unknown,
  boundary: "start" | "end" = "start",
  timeZone = DEFAULT_QUERY_TIMEZONE,
) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return new Date(value);

  const raw = String(value).trim();
  if (!raw) return null;

  if (DATE_ONLY_PATTERN.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return zonedTimeToUtc(
      {
        year,
        month,
        day,
        hour: boundary === "start" ? 0 : 23,
        minute: boundary === "start" ? 0 : 59,
        second: boundary === "start" ? 0 : 59,
        millisecond: boundary === "start" ? 0 : 999,
      },
      timeZone,
    );
  }

  if (DATETIME_LOCAL_PATTERN.test(raw)) {
    const [datePart, timePart] = raw.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute, second = "00"] = timePart.split(":");
    return zonedTimeToUtc(
      {
        year,
        month,
        day,
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
        millisecond: boundary === "end" ? 999 : 0,
      },
      timeZone,
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const buildDateRangeInTimeZone = (
  startRaw: unknown,
  endRaw: unknown,
  days = 30,
  timeZone = DEFAULT_QUERY_TIMEZONE,
) => {
  const now = new Date();
  const end =
    parseDateInTimeZone(endRaw, "end", timeZone) ||
    parseDateInTimeZone(formatDateInTimeZone(now, timeZone), "end", timeZone) ||
    now;

  const startParsed = parseDateInTimeZone(startRaw, "start", timeZone);
  if (startParsed) {
    return { start: startParsed, end };
  }

  const endParts = getTimeZoneParts(end, timeZone);
  const start = zonedTimeToUtc(
    {
      year: endParts.year,
      month: endParts.month,
      day: endParts.day - (days - 1),
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );

  return { start, end };
};

/**
 * @param {Record<string, any>} query - Query filters with pagination, search, projection, sort
 * @param {Array|Object} additionalStages - Optional extra aggregation stages
 * @returns {Object} - { pipeline, matchStage, options }
 */
export const getPipeline = (
  query: Record<string, any>,
  additionalStages?: any[] | Record<string, any>,
  pipelineOptions?: {
    sortFirst?: boolean;
    prependStages?: any[];
    lookupsInDataFacet?: boolean;
    afterQuery?: (formatted: any) => any;
    pipelineModifier?: (pipeline: any[]) => any[];
  },
) => {
  const {
    page = 1,
    limit = 10,
    pagination = "true",

    search = "",
    searchkey = "",
    searchOperator = "or", // 'or' | 'and'

    // Sorting
    multiSort = "", // "field1:asc,field2:desc"
    sortDir = "desc",
    sortKey = "createdAt",

    // Projection
    fields = "",
    exclude = "",

    // Special filters
    exists = "",
    notExists = "",

    ...filters
  } = query;

  const pageNumber = Math.max(parseInt(page, 10), 1);
  const limitNumber = Math.max(parseInt(limit, 10), 1);
  const basePipeline: any[] = [];
  const match: Record<string, any> = {};
  const sortFirst = Boolean(pipelineOptions?.sortFirst);
  const lookupsInDataFacet = Boolean(pipelineOptions?.lookupsInDataFacet);
  const prependStages = Array.isArray(pipelineOptions?.prependStages)
    ? pipelineOptions?.prependStages
    : [];
  const pipelineModifier =
    typeof pipelineOptions?.pipelineModifier === "function"
      ? pipelineOptions.pipelineModifier
      : undefined;
  const paginationMode = String(
    (query as any).paginationMode ?? (query as any).pagination_mode ?? "cursor",
  )
    .toLowerCase()
    .trim();
  const cursorRaw = (query as any).cursor;
  const includeTotalRaw = (query as any).includeTotal;
  const hasPageParam = Object.prototype.hasOwnProperty.call(query, "page");

  // pull out start/end date filters (default to createdAt)
  const startDateFilter = filters.startDate;
  const endDateFilter = filters.endDate;
  delete (filters as any).startDate;
  delete (filters as any).endDate;

  // ==========================================
  // 🔧 HELPER FUNCTIONS
  // ==========================================

  /**
   * Safely convert to ObjectId if valid
   */
  const safeObjectId = (val: any): mongoose.Types.ObjectId | any => {
    if (typeof val === "string" && ObjectId.isValid(val)) {
      return new ObjectId(val);
    }
    return val;
  };

  /**
   * Check if value is truly empty (null, undefined, empty string)
   */
  const isEmpty = (val: any): boolean => {
    return val === null || val === undefined || val === "";
  };

  /**
   * Parse string to appropriate type
   */
  const parseValue = (value: any): any => {
    if (isEmpty(value)) return null;
    if (Array.isArray(value)) {
      return value.map((entry) => parseValue(entry));
    }

    // Boolean
    if (value === "true") return true;
    if (value === "false") return false;

    // Number
    if (!isNaN(value) && value !== "" && typeof value !== "boolean") {
      return Number(value);
    }

    // Date (ISO format)
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) return date;
    }

    // ObjectId
    if (typeof value === "string") {
      const objectIdMatch = value.match(
        /^(?:new\s*)?ObjectId\(['"]?([a-fA-F0-9]{24})['"]?\)$/,
      );
      if (objectIdMatch) {
        return safeObjectId(objectIdMatch[1]);
      }
      if (ObjectId.isValid(value)) {
        return safeObjectId(value);
      }
    }

    // Array (comma-separated)
    if (typeof value === "string" && value.includes(",")) {
      return value.split(",").map((v) => parseValue(v.trim()));
    }

    return value;
  };

  /**
   * Parse cursor from JSON or base64-encoded JSON
   */
  const parseCursor = (raw: any): Record<string, any> | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw === "object") return raw as Record<string, any>;

    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        try {
          const decoded = Buffer.from(raw, "base64").toString("utf8");
          return JSON.parse(decoded);
        } catch {
          return null;
        }
      }
    }

    return null;
  };

  /**
   * Build cursor-based match stage for keyset pagination
   */
  const buildCursorMatch = (
    fields: Array<{ field: string; direction: 1 | -1 }>,
    cursorValues: Record<string, any> | null,
  ): Record<string, any> | null => {
    if (!cursorValues) return null;
    if (!fields.length) return null;

    const normalized: Record<string, any> = {};
    for (const field of fields) {
      if (!(field.field in cursorValues)) return null;
      normalized[field.field] = parseValue(cursorValues[field.field]);
    }

    const or: Record<string, any>[] = [];
    const eq: Record<string, any> = {};

    for (const field of fields) {
      const value = normalized[field.field];
      const op = field.direction === 1 ? "$gt" : "$lt";
      or.push({ ...eq, [field.field]: { [op]: value } });
      eq[field.field] = value;
    }

    return or.length ? { $or: or } : null;
  };

  /**
   * Handle special operators in field names
   * Examples: price__gte, status__in, createdAt__exists
   */
  const parseFieldOperator = (
    key: string,
    value: any,
  ): { field: string; operator: string; value: any } => {
    const parts = key.split("__");
    const field = parts[0];
    const operator = parts[1] || "eq";

    const parsedValue = parseValue(value);

    switch (operator) {
      case "in":
        return {
          field,
          operator: "$in",
          value: Array.isArray(parsedValue) ? parsedValue : [parsedValue],
        };
      case "nin":
        return {
          field,
          operator: "$nin",
          value: Array.isArray(parsedValue) ? parsedValue : [parsedValue],
        };
      case "gte":
        return { field, operator: "$gte", value: parsedValue };
      case "gt":
        return { field, operator: "$gt", value: parsedValue };
      case "lte":
        return { field, operator: "$lte", value: parsedValue };
      case "lt":
        return { field, operator: "$lt", value: parsedValue };
      case "ne":
        return { field, operator: "$ne", value: parsedValue };
      case "exists":
        return { field, operator: "$exists", value: parsedValue === true };
      case "regex":
        return {
          field,
          operator: "$regex",
          value: new RegExp(value, "i"),
        };
      default:
        return { field, operator: "eq", value: parsedValue };
    }
  };

  /**
   * Set nested match dynamically with multi-level support
   * Supports: user.profile.name, items.0.price, tags.*
   */
  const setNestedMatch = (
    obj: any,
    key: string,
    operator: string,
    value: any,
  ) => {
    const keys = key.split(".");
    let current = obj;

    keys.forEach((k, i) => {
      if (i === keys.length - 1) {
        // Last key - apply the value
        if (operator === "eq") {
          // For string values, use case-insensitive regex
          if (typeof value === "string" && operator === "eq") {
            current[k] = { $regex: new RegExp(`^${value}$`, "i") };
          } else {
            current[k] = value;
          }
        } else {
          // For other operators
          current[k] = { [operator]: value };
        }
      } else {
        // Nested path - create if doesn't exist
        if (!current[k]) {
          current[k] = {};
        }
        current = current[k];
      }
    });
  };

  // ==========================================
  // 🔍 BUILD MATCH STAGE
  // ==========================================

  if (startDateFilter || endDateFilter) {
    const createdAtRange: any = {};
    const parsedStart = parseDateInTimeZone(startDateFilter, "start");
    const parsedEnd = parseDateInTimeZone(endDateFilter, "end");
    if (parsedStart) createdAtRange.$gte = parsedStart;
    if (parsedEnd) createdAtRange.$lte = parsedEnd;
    if (Object.keys(createdAtRange).length > 0) {
      match.createdAt = createdAtRange;
    }
  }

  // Process all dynamic filters
  for (const key in filters) {
    const value = filters[key];

    if (isEmpty(value)) continue;

    const {
      field,
      operator,
      value: parsedValue,
    } = parseFieldOperator(key, value);

    setNestedMatch(match, field, operator, parsedValue);
  }

  // Exists/Not Exists
  if (exists) {
    exists.split(",").forEach((field: string) => {
      setNestedMatch(match, field.trim(), "$exists", true);
    });
  }

  if (notExists) {
    notExists.split(",").forEach((field: string) => {
      setNestedMatch(match, field.trim(), "$exists", false);
    });
  }

  if (prependStages.length > 0) {
    basePipeline.push(...prependStages);
  }

  // Add match stage if there are filters
  if (Object.keys(match).length > 0) {
    basePipeline.push({ $match: match });
  }

  // ==========================================
  // 📊 SORTING
  // ==========================================
  const sortStage: Record<string, 1 | -1> = {};
  const sortFields: Array<{ field: string; direction: 1 | -1 }> = [];
  const pushSortField = (field: string, direction: 1 | -1) => {
    if (!field) return;
    sortStage[field] = direction;
    sortFields.push({ field, direction });
  };

  // Multi-field sorting: "price:asc,createdAt:desc"
  if (multiSort) {
    multiSort.split(",").forEach((s: string) => {
      const [field, directionRaw] = s.trim().split(":");
      if (field) {
        const direction = directionRaw === "asc" ? 1 : -1;
        pushSortField(field, direction);
      }
    });
  } else {
    // Single field sorting
    const direction = sortDir === "asc" ? 1 : -1;
    pushSortField(sortKey, direction);
  }

  const usePagination = toBoolean(pagination.toString());
  const includeTotal = toBoolean(includeTotalRaw ?? "false");
  // Only use cursor pagination if:
  // 1. Pagination is enabled
  // 2. paginationMode is explicitly "cursor" (not empty/default)
  // 3. A cursor is actually provided
  // 4. NO page/limit parameters are provided (use page/limit for offset pagination)
  const useCursor =
    usePagination &&
    paginationMode === "cursor" &&
    !!cursorRaw &&
    !hasPageParam;
  const cursor = useCursor ? parseCursor(cursorRaw) : null;
  const hasNestedSort = sortFields.some((f) => f.field.includes("."));

  if (useCursor && !hasNestedSort) {
    const lastDirection =
      sortFields.length > 0 ? sortFields[sortFields.length - 1].direction : -1;
    if (!sortStage._id) {
      pushSortField("_id", lastDirection);
    }
  }

  const lookupStages: any[] = [];
  if (Array.isArray(additionalStages)) {
    lookupStages.push(...additionalStages);
  } else if (additionalStages && typeof additionalStages === "object") {
    lookupStages.push(additionalStages);
  }

  let searchStage: any | null = null;
  let searchKeys: string[] = [];
  if (search && searchkey) {
    const keys = searchkey
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);
    searchKeys = keys;

    if (keys.length > 0) {
      const searchConditions = keys.map((k: any) => ({
        [k]: { $regex: search, $options: "i" },
      }));

      const searchQuery =
        searchOperator === "and"
          ? { $and: searchConditions }
          : { $or: searchConditions };

      searchStage = { $match: searchQuery };
    }
  }

  let projectStage: any | null = null;
  if (fields || exclude) {
    const projectFields: any = {};

    // Include specific fields
    if (fields) {
      fields.split(",").forEach((f: string) => {
        const field = f.trim();
        if (field) projectFields[field] = 1;
      });
    }

    // Exclude specific fields
    if (exclude) {
      exclude.split(",").forEach((f: string) => {
        const field = f.trim();
        if (field) projectFields[field] = 0;
      });
    }

    if (Object.keys(projectFields).length > 0) {
      projectStage = { $project: projectFields };
    }
  }

  const searchNeedsLookup = searchKeys.some((key) => key.includes("."));
  const countPipeline: any[] = [...basePipeline];
  if (searchStage) {
    if (searchNeedsLookup && lookupStages.length > 0) {
      countPipeline.push(...lookupStages);
    }
    countPipeline.push(searchStage);
  }
  countPipeline.push({ $count: "total" });

  // ==========================================
  // 📄 PAGINATION
  // ==========================================
  let pipeline: any[] = [];

  if (usePagination && useCursor && !hasNestedSort) {
    const cursorMatch = buildCursorMatch(sortFields, cursor);
    const fullPipeline = [...basePipeline];
    if (searchStage) fullPipeline.push(searchStage);
    if (cursorMatch) fullPipeline.push({ $match: cursorMatch });
    fullPipeline.push({ $sort: sortStage });
    fullPipeline.push({ $limit: limitNumber + 1 });
    if (lookupStages.length > 0) {
      fullPipeline.push(...lookupStages);
    }
    if (projectStage) fullPipeline.push(projectStage);
    pipeline = [...fullPipeline];
  } else if (usePagination) {
    if (lookupsInDataFacet) {
      const dataStages = [
        { $skip: (pageNumber - 1) * limitNumber },
        { $limit: limitNumber },
        ...lookupStages,
      ];
      if (projectStage) dataStages.push(projectStage);

      pipeline = [
        ...basePipeline,
        ...(searchStage ? [searchStage] : []),
        { $sort: sortStage },
        {
          $facet: {
            data: dataStages,
            metadata: [
              { $count: "total" },
              {
                $addFields: {
                  page: pageNumber,
                  limit: limitNumber,
                  totalPages: {
                    $ceil: { $divide: ["$total", limitNumber] },
                  },
                },
              },
            ],
          },
        },
        {
          $project: {
            data: 1,
            total: { $ifNull: [{ $arrayElemAt: ["$metadata.total", 0] }, 0] },
            page: { $ifNull: [{ $arrayElemAt: ["$metadata.page", 0] }, 1] },
            limit: {
              $ifNull: [{ $arrayElemAt: ["$metadata.limit", 0] }, limitNumber],
            },
            totalPages: {
              $ifNull: [{ $arrayElemAt: ["$metadata.totalPages", 0] }, 0],
            },
          },
        },
      ];
    } else {
      const fullPipeline = [...basePipeline];
      if (sortFirst) {
        fullPipeline.push({ $sort: sortStage });
      }
      if (lookupStages.length > 0) {
        fullPipeline.push(...lookupStages);
      }
      if (searchStage) fullPipeline.push(searchStage);
      if (projectStage) fullPipeline.push(projectStage);
      if (!sortFirst) {
        fullPipeline.push({ $sort: sortStage });
      }

      pipeline = [
        ...fullPipeline,
        {
          $facet: {
            data: [
              { $skip: (pageNumber - 1) * limitNumber },
              { $limit: limitNumber },
            ],
            metadata: [
              { $count: "total" },
              {
                $addFields: {
                  page: pageNumber,
                  limit: limitNumber,
                  totalPages: {
                    $ceil: { $divide: ["$total", limitNumber] },
                  },
                },
              },
            ],
          },
        },
        {
          $project: {
            data: 1,
            total: { $ifNull: [{ $arrayElemAt: ["$metadata.total", 0] }, 0] },
            page: { $ifNull: [{ $arrayElemAt: ["$metadata.page", 0] }, 1] },
            limit: {
              $ifNull: [{ $arrayElemAt: ["$metadata.limit", 0] }, limitNumber],
            },
            totalPages: {
              $ifNull: [{ $arrayElemAt: ["$metadata.totalPages", 0] }, 0],
            },
          },
        },
      ];
    }
  } else {
    const fullPipeline = [...basePipeline];
    if (sortFirst) {
      fullPipeline.push({ $sort: sortStage });
    }
    if (lookupStages.length > 0) {
      fullPipeline.push(...lookupStages);
    }
    if (searchStage) fullPipeline.push(searchStage);
    if (projectStage) fullPipeline.push(projectStage);
    if (!sortFirst) {
      fullPipeline.push({ $sort: sortStage });
    }

    pipeline = [...fullPipeline];
  }

  if (pipelineModifier) {
    const modified = pipelineModifier([...pipeline]);
    if (Array.isArray(modified) && modified.length > 0) {
      pipeline = modified;
    }
  }

  // ==========================================
  // 🎯 RETURN PIPELINE
  // ==========================================
  const paginationModeUsed = useCursor ? "cursor" : "offset";

  return {
    pipeline,
    matchStage: match,
    meta: {
      paginationMode: paginationModeUsed,
      useCursor,
      sortFields,
      limit: limitNumber,
      page: pageNumber,
      includeTotal,
      cursor,
      countPipeline,
    },
    options: {
      collation: { locale: "en", strength: 2 },
      allowDiskUse: true,
    },
  };
};

/**
 * 🟢 Format the result with pagination info
 * @param {number} pageNumber - Current page number
 * @param {number} limitNumber - Number of items per page
 * @param {number} totalResults - Total number of items
 * @param {Array<any>} results - The result set
 * @returns {Object} - The paginated result with pagination metadata
 */
export const paginationResult = (
  pageNumber: number,
  limitNumber: number,
  totalResults: number,
  results: any[],
) => {
  return {
    result: results,
    pagination: {
      currentPage: pageNumber,
      totalItems: totalResults,
      itemsPerPage: limitNumber,
      totalPages: Math.ceil(totalResults / limitNumber),
    },
  };
};

/**
 * 🟢 Convert a string to a valid MongoDB ObjectId
 * @param {string} id - The string to convert
 * @returns {ObjectId | null} - The ObjectId or null if invalid
 */
export const convertToObjectId = (
  id: string,
): mongoose.Types.ObjectId | null => {
  try {
    return new ObjectId(id);
  } catch (error) {
    console.log("Invalid ObjectId:", error);
    return null;
  }
};

/**
 * 🟢 Check if a string is a valid MongoDB ObjectId
 * @param {string} id - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidObjectId = (id: string): boolean => {
  try {
    return ObjectId.isValid(id);
  } catch (error) {
    return false;
  }
};

/**
 * 🟢 Check if a string is a valid UUID
 * @param {string} uuid - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * 🟢 Check if a string is a valid email
 * @param {string} email - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

/**
 * 🟢 Check if a string is a valid URL
 * @param {string} url - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidURL = (url: string): boolean => {
  const urlRegex = /^(https?:\/\/)?([a-zA-Z0-9.-]+)(:[0-9]+)?(\/[^\s]*)?$/;
  return urlRegex.test(url);
};

/**
 * 🟢 Check if a string is a valid phone number
 * @param {string} phone - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidPhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  return phoneRegex.test(phone);
};

/**
 * 🟢 Check if a string is a valid date
 * @param {string} date - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidDate = (date: string): boolean => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD format
  if (!dateRegex.test(date)) return false;

  const parsedDate = new Date(date);
  return !isNaN(parsedDate.getTime());
};

/**
 * 🟢 Check if a string is a valid time
 * @param {string} time - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidTime = (time: string): boolean => {
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:mm format
  return timeRegex.test(time);
};

/**
 * 🟢 Check if a string is a valid datetime
 * @param {string} datetime - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidDateTime = (datetime: string): boolean => {
  const datetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/; // ISO 8601 format
  return datetimeRegex.test(datetime);
};

/**
 * 🟢 Check if a string is a valid JSON
 * @param {string} jsonString - The string to check
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidJSON = (jsonString: string): boolean => {
  try {
    JSON.parse(jsonString);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Extracts S3 key from a full URL
 * Handles different URL formats:
 * - https://bucket.s3.region.amazonaws.com/key
 * - https://baseUrl/bucket/key
 * - http://localhost:9000/bucket/key (MinIO)
 */
export const extractS3KeyFromUrl = (url: string): string | null => {
  if (!url || typeof url !== "string") return null;

  try {
    // Handle standard S3 URLs: https://bucket.s3.region.amazonaws.com/key
    if (url.includes(".s3.") && url.includes(".amazonaws.com/")) {
      const parts = url.split(".amazonaws.com/");
      if (parts.length > 1) return parts[1];
    }

    // Handle custom baseUrl (MinIO, Wasabi, etc.): https://baseUrl/bucket/key
    // Extract everything after the bucket name
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      // Skip bucket name, return the rest
      return pathParts.slice(1).join("/");
    }

    // Fallback: try to extract after .com/ or last /
    const match = url.match(/(?:\.com\/|:\/\/[^\/]+\/)(.+)$/);
    if (match && match[1]) return match[1];

    return null;
  } catch (error) {
    console.error("Error extracting S3 key:", error);
    return null;
  }
};

/**
 * Deletes image from S3 if URL is a valid S3 URL
 */
export const deleteImageFromS3 = async (
  url: string | null | undefined,
): Promise<void> => {
  if (!url || typeof url !== "string") return;

  // Only delete if it's an S3 URL (not blob URLs or local URLs)
  if (
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    !url.includes("http")
  ) {
    return;
  }

  const s3Key = extractS3KeyFromUrl(url);
  if (s3Key) {
    try {
      await deleteFromS3(s3Key);
    } catch (error) {
      console.error(`Failed to delete image from S3: ${url}`, error);
      // Don't throw - allow update to continue even if S3 delete fails
    }
  }
};

/**
 * Extracts image URL and handles deletion of old images
 * - If input is null/empty and existing exists: delete existing from S3, return empty
 * - If input is new and different from existing: delete existing from S3, return new
 * - If input is same as existing: return existing (no deletion)
 */
export const extractImageUrl = async (
  input: any,
  existing: string | null | undefined,
): Promise<string> => {
  // Handle deletion: if input is explicitly null/empty and existing exists
  const isDeletion =
    input === null ||
    input === undefined ||
    input === "" ||
    (Array.isArray(input) && input.length === 0) ||
    (Array.isArray(input) &&
      input.length === 1 &&
      (input[0] === null ||
        input[0] === "" ||
        input[0]?.url === null ||
        input[0]?.url === ""));

  if (isDeletion) {
    // Delete existing image from S3 if it exists
    if (existing) {
      await deleteImageFromS3(existing);
    }
    return "";
  }

  // Extract new URL from input
  let newUrl: string | undefined;

  if (Array.isArray(input) && input.length > 0) {
    newUrl =
      input[0]?.url || (typeof input[0] === "string" ? input[0] : undefined);
  } else if (typeof input === "string") {
    newUrl = input;
  } else if (input && typeof input === "object" && input.url) {
    newUrl = input.url;
  }

  // If new URL is different from existing, delete the old one
  if (existing && newUrl && existing !== newUrl) {
    await deleteImageFromS3(existing);
  }

  return newUrl || existing || "";
};

/**
 * Handles array of images - detects deletions and removes them from S3
 * Returns the final array of URLs and deletes removed images from S3
 */
export const extractImageArray = async (
  input: any,
  existing: string[] | null | undefined,
): Promise<string[]> => {
  const existingArray = existing || [];

  // Normalize input to array of URLs
  let incomingUrls: string[] = [];

  if (Array.isArray(input)) {
    incomingUrls = input
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && item.url) return item.url;
        return null;
      })
      .filter((url): url is string => url !== null && url !== "");
  } else if (input && typeof input === "string") {
    incomingUrls = [input];
  }

  // Find images that were removed (exist in existing but not in incoming)
  const removedUrls = existingArray.filter(
    (url) => !incomingUrls.includes(url),
  );

  // Delete removed images from S3
  await Promise.all(removedUrls.map((url) => deleteImageFromS3(url)));

  return incomingUrls;
};
