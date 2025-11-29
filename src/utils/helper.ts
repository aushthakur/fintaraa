import { ObjectId } from "mongodb";
import { toBoolean } from "validator";
import { deleteFromS3 } from "../config/s3Uploader";

/**
 * @param {Record<string, any>} query - Query filters with pagination, search, projection, sort
 * @param {Array|Object} additionalStages - Optional extra aggregation stages
 * @returns {Object} - { pipeline, matchStage, options }
 */
export const getPipeline = (
  query: Record<string, any>,
  additionalStages?: any[] | Record<string, any>
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

  // ==========================================
  // 🔧 HELPER FUNCTIONS
  // ==========================================

  /**
   * Safely convert to ObjectId if valid
   */
  const safeObjectId = (val: any): ObjectId | any => {
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
    if (typeof value === "string" && ObjectId.isValid(value)) {
      return safeObjectId(value);
    }

    // Array (comma-separated)
    if (typeof value === "string" && value.includes(",")) {
      return value.split(",").map((v) => parseValue(v.trim()));
    }

    return value;
  };

  /**
   * Handle special operators in field names
   * Examples: price__gte, status__in, createdAt__exists
   */
  const parseFieldOperator = (
    key: string,
    value: any
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
    value: any
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

  // Process all dynamic filters
  for (const key in filters) {
    const value = filters[key];

    if (isEmpty(value)) continue;

    // If value is already a MongoDB query object (e.g., { $ne: ... }, { $in: ... }), use it directly
    if (typeof value === "object" && !Array.isArray(value) && value !== null && !(value instanceof Date) && !(value instanceof ObjectId)) {
      // Check if it's a MongoDB operator object (has keys starting with $)
      const isMongoOperator = Object.keys(value).some(k => k.startsWith("$"));
      if (isMongoOperator) {
        setNestedMatch(match, key, "eq", value);
        continue;
      }
    }

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

  // Add match stage if there are filters
  if (Object.keys(match).length > 0) {
    basePipeline.push({ $match: match });
  }

  // ==========================================
  // 🔗 ADDITIONAL STAGES (Lookups, etc.)
  // ==========================================
  if (Array.isArray(additionalStages)) {
    basePipeline.push(...additionalStages);
  } else if (additionalStages && typeof additionalStages === "object") {
    basePipeline.push(additionalStages);
  }

  // ==========================================
  // 🔎 ADVANCED SEARCH
  // ==========================================
  if (search && searchkey) {
    const keys = searchkey
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);

    if (keys.length > 0) {
      const searchConditions = keys.map((k: any) => ({
        [k]: { $regex: search, $options: "i" },
      }));

      const searchQuery =
        searchOperator === "and"
          ? { $and: searchConditions }
          : { $or: searchConditions };

      basePipeline.push({ $match: searchQuery });
    }
  }

  // ==========================================
  // 📋 PROJECTION
  // ==========================================
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
      basePipeline.push({ $project: projectFields });
    }
  }

  // ==========================================
  // 📊 SORTING
  // ==========================================
  const sortStage: Record<string, 1 | -1> = {};

  // Multi-field sorting: "price:asc,createdAt:desc"
  if (multiSort) {
    multiSort.split(",").forEach((s: string) => {
      const [field, direction] = s.trim().split(":");
      if (field) {
        sortStage[field] = direction === "asc" ? 1 : -1;
      }
    });
  } else {
    // Single field sorting
    sortStage[sortKey] = sortDir === "asc" ? 1 : -1;
  }

  basePipeline.push({ $sort: sortStage });

  // ==========================================
  // 📄 PAGINATION
  // ==========================================
  let pipeline: any[] = [];

  if (toBoolean(pagination.toString())) {
    pipeline = [
      ...basePipeline,
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
  } else {
    pipeline = [...basePipeline];
  }

  // ==========================================
  // 🎯 RETURN PIPELINE
  // ==========================================
  return {
    pipeline,
    matchStage: match,
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
  results: any[]
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
export const convertToObjectId = (id: string): ObjectId | null => {
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
    new ObjectId(id);
    return true;
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

export const extractImageUrl = async (input: any, existing: string) => {
  if (!input || (Array.isArray(input) && input.length === 0))
    return existing || "";
  if (Array.isArray(input) && input.length > 0) {
    const newUrl = input[0]?.url;
    if (existing && existing !== newUrl) {
      const s3Key = existing.split(".com/")[1];
      await deleteFromS3(s3Key);
    }
    return newUrl || "";
  }
  if (typeof input === "string") return input;
  return existing || "";
};
