import { ObjectId } from "mongodb";
import { deleteFromS3 } from "../config/s3Uploader";

/**
 * 🟢 Build the MongoDB aggregation pipeline based on query filters
 * @param {Record<string, any>} query - The query parameters to build the pipeline from
 * @returns {Object} - The constructed pipeline and matching stage
 */
export const getPipeline = (
  query: Record<string, any>,
  additionalStages?: any[] | Record<string, any>
) => {
  const {
    _id,
    user,
    type,
    role,
    owner,
    roomId,
    status,
    userId,
    guestId,
    endDate,
    isActive,
    postedBy,
    property,
    assignee,
    userType,
    createdBy,
    startDate,
    community,
    searchkey,
    countryId,
    isPopular,
    isVerified,
    propertyId,
    applicantId,
    isRecommended,
    page = 1,
    limit = 10,
    search = "",
    sortDir = "desc",
    sortKey = "createdAt",
  } = query;

  const pageNumber = Math.max(parseInt(page, 10), 1);
  const limitNumber = Math.max(parseInt(limit, 10), 1);
  const basePipeline: any[] = [];
  const match: Record<string, any> = {};

  const safeObjectId = (val: any) =>
    ObjectId.isValid(val) ? new ObjectId(val) : val;

  // Basic match filters
  if (type) match.type = type;
  if (role) match.role = role;
  if (status) match.status = status;
  if (_id) match._id = safeObjectId(_id);
  if (userType) match.userType = userType;
  if (user) match.user = safeObjectId(user);
  if (owner) match.owner = safeObjectId(owner);
  if (roomId) match.roomId = safeObjectId(roomId);
  if (userId) match.userId = safeObjectId(userId);
  if (guestId) match.guestId = safeObjectId(guestId);
  if (postedBy) match.postedBy = safeObjectId(postedBy);
  if (property) match.property = safeObjectId(property);
  if (assignee) match.assignee = safeObjectId(assignee);
  if (createdBy) match.createdBy = safeObjectId(createdBy);
  if (community) match.community = safeObjectId(community);
  if (countryId) match.countryId = safeObjectId(countryId);
  if (propertyId) match.propertyId = safeObjectId(propertyId);
  if (applicantId) match.applicant = safeObjectId(applicantId);
  if (isActive) match.isActive = { $in: [true, "true", "active", 1] };
  if (isPopular) match.isPopular = { $in: [true, "true", "active", 1] };
  if (isVerified) match.isVerified = { $in: [true, "true", "active", 1] };
  if (isRecommended) match.isRecommended = { $in: [true, "true", "active", 1] };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  if (Object.keys(match).length) basePipeline.push({ $match: match });

  // Add additional stages before faceting (lookups, projections, etc.)
  if (Array.isArray(additionalStages)) basePipeline.push(...additionalStages);
  else if (additionalStages && typeof additionalStages === "object")
    basePipeline.push(additionalStages);

  // Search (including multi-field)
  if (search && searchkey) {
    const keys = searchkey
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);

    if (keys.length > 1) {
      basePipeline.push({
        $match: {
          $or: keys.map((key: any) => ({
            [key]: { $regex: search, $options: "i" },
          })),
        },
      });
    } else {
      const key = keys[0];
      if (["_id", "category"].includes(key)) {
        basePipeline.push({ $addFields: { idStr: { $toString: `$${key}` } } });
        basePipeline.push({
          $match: { idStr: { $regex: search, $options: "i" } },
        });
        basePipeline.push({ $project: { idStr: 0 } });
      } else {
        basePipeline.push({
          $match: { [key]: { $regex: search, $options: "i" } },
        });
      }
    }
  }

  // Wrap in facet for pagination and total count
  const pipeline = [
    ...basePipeline,
    { $sort: { [sortKey]: sortDir === "asc" ? 1 : -1 } },
    {
      $facet: {
        data: [
          { $skip: (pageNumber - 1) * limitNumber },
          { $limit: limitNumber },
        ],
        total: [{ $count: "count" }],
      },
    },
    {
      $addFields: {
        totalCount: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },
      },
    },
  ];

  return {
    pipeline,
    matchStage: match,
    options: { collation: { locale: "en", strength: 2 }, allowDiskUse: true },
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
