import mongoose, { Types } from "mongoose";
import { Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  Partner,
  PartnerIntegrationStatus,
  PartnerProductCategory,
  PartnerStatus,
  PartnerType,
  normalizePartnerSlug,
} from "../../modals/partner.model";
import {
  PartnerFeeType,
  PartnerIncomePeriod,
  PartnerProduct,
} from "../../modals/partnerProduct.model";
import {
  PartnerCredential,
  PartnerCredentialAuthType,
} from "../../modals/partnerCredential.model";
import {
  PartnerApplicationType,
  PartnerAssignment,
  PartnerAssignmentMode,
  PartnerAssignmentStatus,
} from "../../modals/partnerAssignment.model";
import {
  decryptPartnerCredentials,
  encryptPartnerCredentials,
  testPartnerConnectivity,
  validatePartnerCredentialPayload,
} from "../../services/partnerCredential.service";
import {
  getPartnerApplicationContext,
  matchPartnerProducts,
  PartnerMatchResult,
} from "../../services/partnerMatching.service";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const encryptedCredentialSelection = [
  "+encryptedCredentials.version",
  "+encryptedCredentials.iv",
  "+encryptedCredentials.authTag",
  "+encryptedCredentials.ciphertext",
].join(" ");

const userId = (req: Request) =>
  (req as Request & { user?: { _id?: string } }).user?._id;

const parsePagination = (req: Request, defaultLimit = 25) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(
    500,
    Math.max(
      1,
      Number.parseInt(String(req.query.limit || defaultLimit), 10) ||
        defaultLimit,
    ),
  );
  return { page, limit, skip: (page - 1) * limit };
};

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
  required = false,
): T | undefined => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(400, `${label} is required`);
    return undefined;
  }
  const parsed = String(value) as T;
  if (!values.includes(parsed)) {
    throw new ApiError(400, `${label} must be one of: ${values.join(", ")}`);
  }
  return parsed;
};

const objectId = (value: unknown, label: string): Types.ObjectId => {
  if (!mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${label} is invalid`);
  }
  return new Types.ObjectId(String(value));
};

const optionalNumber = (
  value: unknown,
  label: string,
): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ApiError(400, `${label} must be a number`);
  return parsed;
};

const booleanValue = (value: unknown, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  throw new ApiError(400, "Boolean field must be true or false");
};

const stringList = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((item) => item.trim());
  if (values.length > 10000) throw new ApiError(400, `${label} has too many values`);
  return Array.from(
    new Set(values.map((item) => String(item || "").trim()).filter(Boolean)),
  );
};

const assertRange = (
  min: number | undefined,
  max: number | undefined,
  label: string,
) => {
  if (min !== undefined && max !== undefined && min > max) {
    throw new ApiError(400, `${label} minimum cannot exceed maximum`);
  }
};

const assertBounds = (
  value: number | undefined,
  label: string,
  min: number,
  max?: number,
) => {
  if (value === undefined) return;
  if (value < min || (max !== undefined && value > max)) {
    throw new ApiError(
      400,
      `${label} must be between ${min} and ${max ?? "the supported maximum"}`,
    );
  }
};

const assertWebUrl = (value: unknown, label: string) => {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    if (parsed.username || parsed.password) throw new Error();
    return parsed.toString();
  } catch (_error) {
    throw new ApiError(400, `${label} must be a valid HTTP(S) URL`);
  }
};

const assertPartnerApiBaseUrl = (value: unknown) => {
  const safeUrl = assertWebUrl(value, "baseUrl");
  if (!safeUrl) return safeUrl;
  const parsed = new URL(safeUrl);
  if (parsed.search || parsed.hash) {
    throw new ApiError(
      400,
      "baseUrl cannot contain query parameters or fragments; store API secrets in credentials",
    );
  }
  return safeUrl;
};

const hasOwn = (value: unknown, key: string) =>
  Boolean(
    value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, key),
  );

const isExplicitUnset = (value: unknown) => value === null || value === "";

const productTopLevelOptionalNumbers = [
  "interestRateMin",
  "interestRateMax",
  "amountMin",
  "amountMax",
  "tenureMinMonths",
  "tenureMaxMonths",
  "priority",
] as const;

const productNestedFields = {
  processingFee: ["type", "value"],
  eligibility: [
    "cibilMin",
    "cibilMax",
    "incomeMin",
    "incomeMax",
    "incomePeriod",
    "employmentTypes",
    "ageMin",
    "ageMax",
    "cities",
    "pincodes",
    "companyCategories",
  ],
  insurance: [
    "premiumMin",
    "premiumMax",
    "coverageMin",
    "coverageMax",
    "policyTermMinMonths",
    "policyTermMaxMonths",
  ],
} as const;

export const buildPartnerProductUpdateOperation = (
  body: Record<string, any>,
  payload: Record<string, any>,
) => {
  const set: Record<string, any> = { ...payload };
  const unset: Record<string, ""> = {};

  for (const field of productTopLevelOptionalNumbers) {
    if (hasOwn(body, field) && isExplicitUnset(body[field])) {
      delete set[field];
      unset[field] = "";
    }
  }

  for (const [section, fields] of Object.entries(productNestedFields)) {
    if (!hasOwn(body, section)) continue;
    if (body[section] === null) {
      delete set[section];
      unset[section] = "";
      continue;
    }
    const sectionBody = body[section] || {};
    const sectionPayload = payload[section] || {};
    delete set[section];
    for (const field of fields) {
      if (!hasOwn(sectionBody, field)) continue;
      const path = `${section}.${field}`;
      if (isExplicitUnset(sectionBody[field])) {
        unset[path] = "";
      } else if (sectionPayload[field] !== undefined) {
        set[path] = sectionPayload[field];
      }
    }
  }

  return {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
  };
};

const nextOptionalNumber = (
  body: Record<string, any>,
  payload: Record<string, any>,
  existing: Record<string, any>,
  field: string,
) => {
  if (!hasOwn(body, field)) return optionalNumber(existing?.[field], field);
  if (isExplicitUnset(body[field])) return undefined;
  return optionalNumber(payload?.[field], field);
};

const nextNestedOptionalNumber = (
  body: Record<string, any>,
  payload: Record<string, any>,
  existing: Record<string, any>,
  section: string,
  field: string,
) => {
  if (body[section] === null) return undefined;
  if (!hasOwn(body[section], field)) {
    return optionalNumber(existing?.[section]?.[field], `${section}.${field}`);
  }
  if (isExplicitUnset(body[section][field])) return undefined;
  return optionalNumber(payload?.[section]?.[field], `${section}.${field}`);
};

const partnerAssignmentTransitions: Record<
  PartnerAssignmentStatus,
  PartnerAssignmentStatus[]
> = {
  [PartnerAssignmentStatus.SUGGESTED]: [
    PartnerAssignmentStatus.ASSIGNED,
    PartnerAssignmentStatus.REJECTED,
  ],
  [PartnerAssignmentStatus.ASSIGNED]: [
    PartnerAssignmentStatus.SENT,
    PartnerAssignmentStatus.ACCEPTED,
    PartnerAssignmentStatus.APPROVED,
    PartnerAssignmentStatus.DISBURSED,
    PartnerAssignmentStatus.POLICY_ISSUED,
    PartnerAssignmentStatus.REJECTED,
  ],
  [PartnerAssignmentStatus.SENT]: [
    PartnerAssignmentStatus.ACCEPTED,
    PartnerAssignmentStatus.APPROVED,
    PartnerAssignmentStatus.DISBURSED,
    PartnerAssignmentStatus.POLICY_ISSUED,
    PartnerAssignmentStatus.REJECTED,
  ],
  [PartnerAssignmentStatus.ACCEPTED]: [
    PartnerAssignmentStatus.APPROVED,
    PartnerAssignmentStatus.DISBURSED,
    PartnerAssignmentStatus.POLICY_ISSUED,
    PartnerAssignmentStatus.REJECTED,
  ],
  [PartnerAssignmentStatus.APPROVED]: [
    PartnerAssignmentStatus.DISBURSED,
    PartnerAssignmentStatus.POLICY_ISSUED,
    PartnerAssignmentStatus.REJECTED,
  ],
  [PartnerAssignmentStatus.REJECTED]: [],
  [PartnerAssignmentStatus.DISBURSED]: [],
  [PartnerAssignmentStatus.POLICY_ISSUED]: [],
};

export const isPartnerAssignmentTransitionAllowed = (
  from: PartnerAssignmentStatus,
  to: PartnerAssignmentStatus,
) => partnerAssignmentTransitions[from]?.includes(to) || false;

const duplicateError = (error: any, message: string): never => {
  if (error?.code === 11000) throw new ApiError(409, message);
  throw error;
};

const buildPartnerPayload = (
  body: Record<string, any>,
  create: boolean,
): Record<string, any> => {
  const payload: Record<string, any> = {};
  if (create || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new ApiError(400, "name is required");
    payload.name = name;
  }
  if (create || body.slug !== undefined) {
    const slug = normalizePartnerSlug(body.slug || body.name);
    if (!slug) throw new ApiError(400, "slug is required");
    payload.slug = slug;
  }
  if (create || body.type !== undefined) {
    payload.type = enumValue(
      body.type,
      Object.values(PartnerType),
      "type",
      true,
    );
  }
  if (body.logo !== undefined) payload.logo = String(body.logo || "").trim();
  if (body.status !== undefined) {
    payload.status = enumValue(
      body.status,
      Object.values(PartnerStatus),
      "status",
      true,
    );
  }
  if (body.featured !== undefined) payload.featured = booleanValue(body.featured);
  if (body.priority !== undefined) {
    payload.priority = optionalNumber(body.priority, "priority");
    assertBounds(payload.priority, "priority", 0);
  }
  if (body.website !== undefined) payload.website = assertWebUrl(body.website, "website");
  if (body.description !== undefined) {
    payload.description = String(body.description || "").trim();
  }
  if (body.regulatoryIds !== undefined) {
    const ids = body.regulatoryIds || {};
    payload.regulatoryIds = {
      rbiRegistrationNumber: String(ids.rbiRegistrationNumber || "").trim(),
      irdaRegistrationNumber: String(ids.irdaRegistrationNumber || "").trim(),
      cin: String(ids.cin || "").trim().toUpperCase(),
      gstin: String(ids.gstin || "").trim().toUpperCase(),
      licenseNumber: String(ids.licenseNumber || "").trim(),
    };
  }
  if (body.contacts !== undefined) {
    if (!Array.isArray(body.contacts)) {
      throw new ApiError(400, "contacts must be an array");
    }
    if (body.contacts.length > 50) throw new ApiError(400, "contacts cannot exceed 50 entries");
    payload.contacts = body.contacts.map((contact: Record<string, any>) => {
      const name = String(contact?.name || "").trim();
      if (!name) throw new ApiError(400, "Every contact requires a name");
      return {
        name,
        role: String(contact.role || "").trim(),
        email: String(contact.email || "").trim().toLowerCase(),
        phone: String(contact.phone || "").trim(),
        isPrimary: booleanValue(contact.isPrimary, false),
      };
    });
  }
  if (body.productCategories !== undefined) {
    payload.productCategories = stringList(
      body.productCategories,
      "productCategories",
    ).map((category) =>
      enumValue(
        category,
        Object.values(PartnerProductCategory),
        "product category",
        true,
      ),
    );
  }
  if (body.serviceAreas !== undefined) {
    const areas = body.serviceAreas || {};
    payload.serviceAreas = {
      countrywide: booleanValue(areas.countrywide, false),
      states: stringList(areas.states, "states"),
      cities: stringList(areas.cities, "cities"),
      pincodes: stringList(areas.pincodes, "pincodes").map((item) =>
        item.replace(/\s+/g, ""),
      ),
    };
  }
  return payload;
};

const buildProductPayload = (
  body: Record<string, any>,
  create: boolean,
): Record<string, any> => {
  const payload: Record<string, any> = {};
  if (create || body.partner !== undefined || body.partnerId !== undefined) {
    payload.partner = objectId(body.partner || body.partnerId, "partner");
  }
  if (create || body.category !== undefined) {
    payload.category = enumValue(
      body.category,
      Object.values(PartnerProductCategory),
      "category",
      true,
    );
  }
  for (const field of ["productType", "code", "name", "description"] as const) {
    if (create || body[field] !== undefined) {
      const value = String(body[field] || "").trim();
      if (create && field !== "description" && !value) {
        throw new ApiError(400, `${field} is required`);
      }
      payload[field] = value;
    }
  }
  for (const field of [
    "interestRateMin",
    "interestRateMax",
    "amountMin",
    "amountMax",
    "tenureMinMonths",
    "tenureMaxMonths",
    "priority",
  ] as const) {
    if (body[field] !== undefined) payload[field] = optionalNumber(body[field], field);
  }
  assertRange(payload.interestRateMin, payload.interestRateMax, "Interest rate");
  assertRange(payload.amountMin, payload.amountMax, "Amount");
  assertRange(payload.tenureMinMonths, payload.tenureMaxMonths, "Tenure");
  assertBounds(payload.interestRateMin, "interestRateMin", 0, 100);
  assertBounds(payload.interestRateMax, "interestRateMax", 0, 100);
  assertBounds(payload.amountMin, "amountMin", 0);
  assertBounds(payload.amountMax, "amountMax", 0);
  assertBounds(payload.tenureMinMonths, "tenureMinMonths", 0);
  assertBounds(payload.tenureMaxMonths, "tenureMaxMonths", 0);
  assertBounds(payload.priority, "priority", 0);

  if (body.processingFee !== undefined) {
    const fee = body.processingFee || {};
    payload.processingFee = {
      type: enumValue(
        fee.type || PartnerFeeType.NONE,
        Object.values(PartnerFeeType),
        "processingFee.type",
        true,
      ),
      value: optionalNumber(fee.value, "processingFee.value"),
    };
    assertBounds(payload.processingFee.value, "processingFee.value", 0);
    if (payload.processingFee.type === PartnerFeeType.PERCENTAGE) {
      assertBounds(payload.processingFee.value, "processingFee.value", 0, 100);
    }
  }
  if (body.eligibility !== undefined) {
    const rules = body.eligibility || {};
    const cibilMin = optionalNumber(rules.cibilMin, "eligibility.cibilMin");
    const cibilMax = optionalNumber(rules.cibilMax, "eligibility.cibilMax");
    const incomeMin = optionalNumber(rules.incomeMin, "eligibility.incomeMin");
    const incomeMax = optionalNumber(rules.incomeMax, "eligibility.incomeMax");
    const ageMin = optionalNumber(rules.ageMin, "eligibility.ageMin");
    const ageMax = optionalNumber(rules.ageMax, "eligibility.ageMax");
    assertRange(cibilMin, cibilMax, "CIBIL");
    assertRange(incomeMin, incomeMax, "Income");
    assertRange(ageMin, ageMax, "Age");
    assertBounds(cibilMin, "eligibility.cibilMin", 300, 900);
    assertBounds(cibilMax, "eligibility.cibilMax", 300, 900);
    assertBounds(incomeMin, "eligibility.incomeMin", 0);
    assertBounds(incomeMax, "eligibility.incomeMax", 0);
    assertBounds(ageMin, "eligibility.ageMin", 0, 120);
    assertBounds(ageMax, "eligibility.ageMax", 0, 120);
    payload.eligibility = {
      cibilMin,
      cibilMax,
      incomeMin,
      incomeMax,
      incomePeriod: enumValue(
        rules.incomePeriod || PartnerIncomePeriod.MONTHLY,
        Object.values(PartnerIncomePeriod),
        "eligibility.incomePeriod",
        true,
      ),
      employmentTypes: stringList(
        rules.employmentTypes,
        "eligibility.employmentTypes",
      ),
      ageMin,
      ageMax,
      cities: stringList(rules.cities, "eligibility.cities"),
      pincodes: stringList(rules.pincodes, "eligibility.pincodes").map((item) =>
        item.replace(/\s+/g, ""),
      ),
      companyCategories: stringList(
        rules.companyCategories,
        "eligibility.companyCategories",
      ),
    };
  }
  if (body.insurance !== undefined) {
    const insurance = body.insurance || {};
    const fields = [
      "premiumMin",
      "premiumMax",
      "coverageMin",
      "coverageMax",
      "policyTermMinMonths",
      "policyTermMaxMonths",
    ] as const;
    payload.insurance = Object.fromEntries(
      fields.map((field) => [
        field,
        optionalNumber(insurance[field], `insurance.${field}`),
      ]),
    );
    assertRange(payload.insurance.premiumMin, payload.insurance.premiumMax, "Premium");
    assertRange(payload.insurance.coverageMin, payload.insurance.coverageMax, "Coverage");
    assertRange(
      payload.insurance.policyTermMinMonths,
      payload.insurance.policyTermMaxMonths,
      "Policy term",
    );
    for (const [field, value] of Object.entries(payload.insurance)) {
      assertBounds(value as number | undefined, `insurance.${field}`, 0);
    }
  }
  if (body.active !== undefined) payload.active = booleanValue(body.active);
  if (body.published !== undefined) payload.published = booleanValue(body.published);
  if (body.assignmentEnabled !== undefined) {
    payload.assignmentEnabled = booleanValue(body.assignmentEnabled);
  }
  return payload;
};

const requirePartner = async (id: unknown, includeDeleted = false) => {
  const partnerId = objectId(id, "partner id");
  const partner = await Partner.findOne({
    _id: partnerId,
    ...(includeDeleted ? {} : { isDeleted: false }),
  });
  if (!partner) throw new ApiError(404, "Partner not found");
  return partner;
};

const syncPartnerProductCategories = async (
  partnerValues: Array<unknown>,
) => {
  const partnerIds = Array.from(
    new Set(
      partnerValues
        .map((value: any) => String(value?._id || value || ""))
        .filter((value) => mongoose.isValidObjectId(value)),
    ),
  ).map((value) => new Types.ObjectId(value));
  if (!partnerIds.length) return;
  const groups = await PartnerProduct.aggregate([
    { $match: { partner: { $in: partnerIds }, isDeleted: false } },
    { $group: { _id: "$partner", categories: { $addToSet: "$category" } } },
  ]);
  const categoryMap = new Map(
    groups.map((group) => [String(group._id), group.categories]),
  );
  await Promise.all(
    partnerIds.map((partnerId) =>
      Partner.updateOne(
        { _id: partnerId },
        {
          $set: {
            productCategories: categoryMap.get(String(partnerId)) || [],
          },
        },
      ),
    ),
  );
};

const populateAssignment = async (id: Types.ObjectId) =>
  PartnerAssignment.findById(id)
    .populate("partner", "name slug logo type status integrationStatus")
    .populate(
      "product",
      "name code category productType interestRateMin interestRateMax",
    )
    .lean();

const createDedupedAssignment = async (args: {
  context: Awaited<ReturnType<typeof getPartnerApplicationContext>>;
  partnerId: Types.ObjectId;
  productId: Types.ObjectId;
  mode: PartnerAssignmentMode;
  status?: PartnerAssignmentStatus;
  match?: PartnerMatchResult;
  externalApplicationId?: string;
  note?: string;
  actor?: string;
}) => {
  const dedupe = {
    applicationType: args.context.applicationType,
    application: args.context.application,
    partner: args.partnerId,
    product: args.productId,
  };
  const existing = await PartnerAssignment.findOne(dedupe);
  if (existing) {
    return { assignment: await populateAssignment(existing._id), created: false };
  }
  const status = args.status || PartnerAssignmentStatus.ASSIGNED;
  const actor = args.actor && mongoose.isValidObjectId(args.actor)
    ? new Types.ObjectId(args.actor)
    : undefined;
  try {
    const assignment = await PartnerAssignment.create({
      ...dedupe,
      applicationModel: args.context.applicationModel,
      applicationId: args.context.applicationId,
      mode: args.mode,
      status,
      matchScore: args.match?.score,
      matchReasons: args.match?.reasons || [],
      matchChecks: args.match?.checks || [],
      externalApplicationId: String(args.externalApplicationId || "").trim(),
      assignedBy: actor,
      updatedBy: actor,
      assignedAt: new Date(),
      auditHistory: [
        {
          toStatus: status,
          note: args.note || `${args.mode} partner assignment created`,
          actor,
          metadata: { mode: args.mode, matchScore: args.match?.score },
          createdAt: new Date(),
        },
      ],
    });
    return { assignment: await populateAssignment(assignment._id), created: true };
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const raced = await PartnerAssignment.findOne(dedupe);
    if (!raced) throw error;
    return { assignment: await populateAssignment(raced._id), created: false };
  }
};

export class AdminPartnerController {
  static async summary(_req: Request, res: Response) {
    const [partnerGroups, productGroups, assignmentGroups] = await Promise.all([
      Partner.aggregate([
        { $match: { isDeleted: false } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: {
              $sum: { $cond: [{ $eq: ["$status", PartnerStatus.ACTIVE] }, 1, 0] },
            },
            inactive: {
              $sum: { $cond: [{ $eq: ["$status", PartnerStatus.INACTIVE] }, 1, 0] },
            },
            bank: { $sum: { $cond: [{ $eq: ["$type", PartnerType.BANK] }, 1, 0] } },
            nbfc: { $sum: { $cond: [{ $eq: ["$type", PartnerType.NBFC] }, 1, 0] } },
            insurer: { $sum: { $cond: [{ $eq: ["$type", PartnerType.INSURER] }, 1, 0] } },
            connected: {
              $sum: {
                $cond: [
                  { $eq: ["$integrationStatus", PartnerIntegrationStatus.CONNECTED] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      PartnerProduct.aggregate([
        { $match: { isDeleted: false } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ["$active", 1, 0] } },
            published: { $sum: { $cond: ["$published", 1, 0] } },
            loan: {
              $sum: {
                $cond: [{ $eq: ["$category", PartnerProductCategory.LOAN] }, 1, 0],
              },
            },
            insurance: {
              $sum: {
                $cond: [
                  { $eq: ["$category", PartnerProductCategory.INSURANCE] },
                  1,
                  0,
                ],
              },
            },
            creditCard: {
              $sum: {
                $cond: [
                  { $eq: ["$category", PartnerProductCategory.CREDIT_CARD] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      PartnerAssignment.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    const assignments = Object.fromEntries(
      Object.values(PartnerAssignmentStatus).map((status) => [status, 0]),
    ) as Record<string, number>;
    for (const item of assignmentGroups) assignments[item._id] = item.count;
    const partnerDefaults = {
      total: 0,
      active: 0,
      inactive: 0,
      bank: 0,
      nbfc: 0,
      insurer: 0,
      connected: 0,
    };
    const productDefaults = {
      total: 0,
      active: 0,
      published: 0,
      loan: 0,
      insurance: 0,
      creditCard: 0,
    };
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          partners: { ...partnerDefaults, ...(partnerGroups[0] || {}), _id: undefined },
          products: { ...productDefaults, ...(productGroups[0] || {}), _id: undefined },
          assignments,
        },
        "Partner summary fetched successfully",
      ),
    );
  }

  static async performance(req: Request, res: Response) {
    const partnerFilter = req.query.partnerId
      ? objectId(req.query.partnerId, "partnerId")
      : undefined;
    const type = enumValue(req.query.type, Object.values(PartnerType), "type");
    const assignmentMatch: Record<string, any> = {
      ...(partnerFilter ? { partner: partnerFilter } : {}),
    };
    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined;
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : undefined;
    if (dateFrom && Number.isNaN(dateFrom.getTime())) throw new ApiError(400, "dateFrom is invalid");
    if (dateTo && Number.isNaN(dateTo.getTime())) throw new ApiError(400, "dateTo is invalid");
    if (dateFrom || dateTo) {
      assignmentMatch.assignedAt = {
        ...(dateFrom ? { $gte: dateFrom } : {}),
        ...(dateTo ? { $lte: dateTo } : {}),
      };
    }
    const [partners, metrics] = await Promise.all([
      Partner.find({
        isDeleted: false,
        ...(partnerFilter ? { _id: partnerFilter } : {}),
        ...(type ? { type } : {}),
      })
        .select("name slug logo type status")
        .sort({ priority: 1, name: 1 })
        .lean(),
      PartnerAssignment.aggregate([
        { $match: assignmentMatch },
        {
          $group: {
            _id: "$partner",
            assigned: {
              $sum: {
                $cond: [
                  { $ne: ["$status", PartnerAssignmentStatus.SUGGESTED] },
                  1,
                  0,
                ],
              },
            },
            approved: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$status",
                      [
                        PartnerAssignmentStatus.APPROVED,
                        PartnerAssignmentStatus.DISBURSED,
                        PartnerAssignmentStatus.POLICY_ISSUED,
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            accepted: {
              $sum: {
                $cond: [
                  { $eq: ["$status", PartnerAssignmentStatus.ACCEPTED] },
                  1,
                  0,
                ],
              },
            },
            rejected: {
              $sum: {
                $cond: [
                  { $eq: ["$status", PartnerAssignmentStatus.REJECTED] },
                  1,
                  0,
                ],
              },
            },
            disbursed: {
              $sum: {
                $cond: [
                  { $eq: ["$status", PartnerAssignmentStatus.DISBURSED] },
                  1,
                  0,
                ],
              },
            },
            policyIssued: {
              $sum: {
                $cond: [
                  { $eq: ["$status", PartnerAssignmentStatus.POLICY_ISSUED] },
                  1,
                  0,
                ],
              },
            },
            pending: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$status",
                      [
                        PartnerAssignmentStatus.ASSIGNED,
                        PartnerAssignmentStatus.SENT,
                        PartnerAssignmentStatus.ACCEPTED,
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            averageTurnaroundMs: {
              $avg: {
                $cond: [
                  { $and: [{ $ne: ["$decisionAt", null] }, { $ne: ["$assignedAt", null] }] },
                  { $subtract: ["$decisionAt", "$assignedAt"] },
                  null,
                ],
              },
            },
            decisionCount: {
              $sum: {
                $cond: [{ $ne: ["$decisionAt", null] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);
    const metricsByPartner = new Map(
      metrics.map((item) => [String(item._id), item]),
    );
    const rows = partners.map((partner) => {
      const metric = metricsByPartner.get(String(partner._id)) || {};
      const assigned = Number(metric.assigned || 0);
      const approved = Number(metric.approved || 0);
      const averageTurnaroundMs = Number(metric.averageTurnaroundMs || 0);
      return {
        partner,
        assigned,
        approved,
        accepted: Number(metric.accepted || 0),
        rejected: Number(metric.rejected || 0),
        pending: Number(metric.pending || 0),
        disbursed: Number(metric.disbursed || 0),
        policyIssued: Number(metric.policyIssued || 0),
        conversionRate: assigned ? Number(((approved / assigned) * 100).toFixed(2)) : 0,
        averageTurnaroundMs,
        averageTurnaroundHours: Number((averageTurnaroundMs / 3600000).toFixed(2)),
        decisionCount: Number(metric.decisionCount || 0),
      };
    });
    const summary = rows.reduce(
      (totals, row) => ({
        assigned: totals.assigned + row.assigned,
        approved: totals.approved + row.approved,
        accepted: totals.accepted + row.accepted,
        rejected: totals.rejected + row.rejected,
        pending: totals.pending + row.pending,
        disbursed: totals.disbursed + row.disbursed,
        policyIssued: totals.policyIssued + row.policyIssued,
        decisionCount: totals.decisionCount + row.decisionCount,
        turnaroundTotalMs:
          totals.turnaroundTotalMs +
          row.averageTurnaroundMs * row.decisionCount,
      }),
      {
        assigned: 0,
        approved: 0,
        accepted: 0,
        rejected: 0,
        pending: 0,
        disbursed: 0,
        policyIssued: 0,
        decisionCount: 0,
        turnaroundTotalMs: 0,
      },
    );
    const averageTurnaroundMs = summary.decisionCount
      ? summary.turnaroundTotalMs / summary.decisionCount
      : 0;
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          summary: {
            assigned: summary.assigned,
            approved: summary.approved,
            accepted: summary.accepted,
            rejected: summary.rejected,
            pending: summary.pending,
            disbursed: summary.disbursed,
            policyIssued: summary.policyIssued,
            decisionCount: summary.decisionCount,
            conversionRate: summary.assigned
              ? Number(((summary.approved / summary.assigned) * 100).toFixed(2))
              : 0,
            averageTurnaroundMs,
            averageTurnaroundHours: Number(
              (averageTurnaroundMs / 3600000).toFixed(2),
            ),
          },
          items: rows,
          filters: {
            dateFrom: dateFrom?.toISOString() || null,
            dateTo: dateTo?.toISOString() || null,
            partnerId: partnerFilter || null,
            type: type || null,
          },
        },
        "Partner performance fetched successfully",
      ),
    );
  }

  static async listProducts(req: Request, res: Response) {
    const { page, limit, skip } = parsePagination(req);
    const category = enumValue(
      req.query.category,
      Object.values(PartnerProductCategory),
      "category",
    );
    const search = String(req.query.search || "").trim();
    const filter: Record<string, any> = {
      ...(booleanValue(req.query.includeDeleted, false) ? {} : { isDeleted: false }),
      ...(req.query.partnerId
        ? { partner: objectId(req.query.partnerId, "partnerId") }
        : {}),
      ...(category ? { category } : {}),
      ...(req.query.active !== undefined
        ? { active: booleanValue(req.query.active) }
        : {}),
      ...(req.query.published !== undefined
        ? { published: booleanValue(req.query.published) }
        : {}),
      ...(search
        ? {
            $or: [
              { name: { $regex: escapeRegex(search), $options: "i" } },
              { code: { $regex: escapeRegex(search), $options: "i" } },
              { productType: { $regex: escapeRegex(search), $options: "i" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      PartnerProduct.find(filter)
        .populate("partner", "name slug logo type status")
        .sort({ priority: 1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PartnerProduct.countDocuments(filter),
    ]);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          items,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
        "Partner products fetched successfully",
      ),
    );
  }

  static async createProduct(req: Request, res: Response) {
    const payload = buildProductPayload(req.body || {}, true);
    await requirePartner(payload.partner);
    try {
      const product = await PartnerProduct.create(payload);
      await syncPartnerProductCategories([payload.partner]);
      const result = await PartnerProduct.findById(product._id)
        .populate("partner", "name slug logo type status")
        .lean();
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Partner product created successfully"));
    } catch (error) {
      return duplicateError(error, "A product with this code already exists for the partner");
    }
  }

  static async updateProduct(req: Request, res: Response) {
    const id = objectId(req.params.id, "product id");
    const payload = buildProductPayload(req.body || {}, false);
    if (payload.partner) await requirePartner(payload.partner);
    const existing = await PartnerProduct.findOne({ _id: id, isDeleted: false });
    if (!existing) throw new ApiError(404, "Partner product not found");
    const body = req.body || {};
    assertRange(
      nextOptionalNumber(body, payload, existing as any, "interestRateMin"),
      nextOptionalNumber(body, payload, existing as any, "interestRateMax"),
      "Interest rate",
    );
    assertRange(
      nextOptionalNumber(body, payload, existing as any, "amountMin"),
      nextOptionalNumber(body, payload, existing as any, "amountMax"),
      "Amount",
    );
    assertRange(
      nextOptionalNumber(body, payload, existing as any, "tenureMinMonths"),
      nextOptionalNumber(body, payload, existing as any, "tenureMaxMonths"),
      "Tenure",
    );
    if (hasOwn(body, "eligibility")) {
      assertRange(
        nextNestedOptionalNumber(body, payload, existing as any, "eligibility", "cibilMin"),
        nextNestedOptionalNumber(body, payload, existing as any, "eligibility", "cibilMax"),
        "CIBIL",
      );
      assertRange(
        nextNestedOptionalNumber(body, payload, existing as any, "eligibility", "incomeMin"),
        nextNestedOptionalNumber(body, payload, existing as any, "eligibility", "incomeMax"),
        "Income",
      );
      assertRange(
        nextNestedOptionalNumber(body, payload, existing as any, "eligibility", "ageMin"),
        nextNestedOptionalNumber(body, payload, existing as any, "eligibility", "ageMax"),
        "Age",
      );
    }
    if (hasOwn(body, "insurance")) {
      assertRange(
        nextNestedOptionalNumber(body, payload, existing as any, "insurance", "premiumMin"),
        nextNestedOptionalNumber(body, payload, existing as any, "insurance", "premiumMax"),
        "Premium",
      );
      assertRange(
        nextNestedOptionalNumber(body, payload, existing as any, "insurance", "coverageMin"),
        nextNestedOptionalNumber(body, payload, existing as any, "insurance", "coverageMax"),
        "Coverage",
      );
      assertRange(
        nextNestedOptionalNumber(body, payload, existing as any, "insurance", "policyTermMinMonths"),
        nextNestedOptionalNumber(body, payload, existing as any, "insurance", "policyTermMaxMonths"),
        "Policy term",
      );
    }
    if (hasOwn(body, "processingFee")) {
      const nextFeeType = hasOwn(body.processingFee, "type")
        ? payload.processingFee?.type
        : existing.processingFee?.type;
      const nextFeeValue = nextNestedOptionalNumber(
        body,
        payload,
        existing as any,
        "processingFee",
        "value",
      );
      assertBounds(nextFeeValue, "processingFee.value", 0);
      if (nextFeeType === PartnerFeeType.PERCENTAGE) {
        assertBounds(nextFeeValue, "processingFee.value", 0, 100);
      }
    }
    try {
      const product = await PartnerProduct.findOneAndUpdate(
        { _id: id, isDeleted: false },
        buildPartnerProductUpdateOperation(body, payload),
        { new: true, runValidators: true },
      ).populate("partner", "name slug logo type status");
      if (!product) throw new ApiError(404, "Partner product not found");
      await syncPartnerProductCategories([existing.partner, product.partner]);
      return res
        .status(200)
        .json(new ApiResponse(200, product, "Partner product updated successfully"));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return duplicateError(error, "A product with this code already exists for the partner");
    }
  }

  static async deleteProduct(req: Request, res: Response) {
    const id = objectId(req.params.id, "product id");
    const actor = userId(req);
    const product = await PartnerProduct.findOneAndUpdate(
      { _id: id, isDeleted: false },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: actor && mongoose.isValidObjectId(actor) ? actor : null,
          active: false,
          published: false,
        },
      },
      { new: true },
    );
    if (!product) throw new ApiError(404, "Partner product not found");
    await syncPartnerProductCategories([product.partner]);
    return res.status(200).json(
      new ApiResponse(
        200,
        { id: product._id, isDeleted: true },
        "Partner product deleted successfully",
      ),
    );
  }

  static async match(req: Request, res: Response) {
    const applicationType = enumValue(
      req.body?.applicationType,
      Object.values(PartnerApplicationType),
      "applicationType",
      true,
    ) as PartnerApplicationType;
    const applicationId = String(req.body?.applicationId || "").trim();
    if (!applicationId) throw new ApiError(400, "applicationId is required");
    const category = enumValue(
      req.body?.category,
      Object.values(PartnerProductCategory),
      "category",
    );
    const requiredCategory =
      applicationType === PartnerApplicationType.LOAN
        ? PartnerProductCategory.LOAN
        : PartnerProductCategory.INSURANCE;
    if (category && category !== requiredCategory) {
      throw new ApiError(
        400,
        `${applicationType} applications can only match ${requiredCategory} products`,
      );
    }
    const result = await matchPartnerProducts({
      applicationType,
      applicationId,
      category,
    });
    let assignment: Awaited<ReturnType<typeof createDedupedAssignment>> | null = null;
    if (booleanValue(req.body?.autoAssign, false)) {
      const best = result.matches.find((item) => item.eligible);
      if (best) {
        assignment = await createDedupedAssignment({
          context: result.context,
          partnerId: new Types.ObjectId(String(best.partner._id)),
          productId: new Types.ObjectId(String(best.product._id)),
          mode: PartnerAssignmentMode.AUTO,
          match: best,
          note: "Automatically assigned to the highest-ranked eligible partner",
          actor: userId(req),
        });
      }
    }
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          application: result.application,
          matches: result.matches,
          total: result.matches.length,
          eligibleCount: result.matches.filter((item) => item.eligible).length,
          assignment,
        },
        assignment
          ? "Partner matched and assigned successfully"
          : "Partner matches calculated successfully",
      ),
    );
  }

  static async listAssignments(req: Request, res: Response) {
    const { page, limit, skip } = parsePagination(req);
    const applicationType = enumValue(
      req.query.applicationType,
      Object.values(PartnerApplicationType),
      "applicationType",
    );
    const status = enumValue(
      req.query.status,
      Object.values(PartnerAssignmentStatus),
      "status",
    );
    if (
      status &&
      ![PartnerAssignmentStatus.ASSIGNED, PartnerAssignmentStatus.SENT].includes(
        status,
      )
    ) {
      throw new ApiError(
        400,
        "A new manual assignment can only start as assigned or sent",
      );
    }
    const mode = enumValue(
      req.query.mode,
      Object.values(PartnerAssignmentMode),
      "mode",
    );
    const search = String(req.query.search || "").trim();
    const filter: Record<string, any> = {
      ...(applicationType ? { applicationType } : {}),
      ...(status ? { status } : {}),
      ...(mode ? { mode } : {}),
      ...(req.query.partnerId
        ? { partner: objectId(req.query.partnerId, "partnerId") }
        : {}),
      ...(req.query.productId
        ? { product: objectId(req.query.productId, "productId") }
        : {}),
      ...(search
        ? {
            $or: [
              { applicationId: { $regex: escapeRegex(search), $options: "i" } },
              {
                externalApplicationId: {
                  $regex: escapeRegex(search),
                  $options: "i",
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      PartnerAssignment.find(filter)
        .populate("partner", "name slug logo type status integrationStatus")
        .populate("product", "name code category productType")
        .sort({ assignedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PartnerAssignment.countDocuments(filter),
    ]);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          items,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
        "Partner assignments fetched successfully",
      ),
    );
  }

  static async createAssignment(req: Request, res: Response) {
    const applicationType = enumValue(
      req.body?.applicationType,
      Object.values(PartnerApplicationType),
      "applicationType",
      true,
    ) as PartnerApplicationType;
    const applicationId = String(req.body?.applicationId || "").trim();
    if (!applicationId) throw new ApiError(400, "applicationId is required");
    const partnerId = objectId(req.body?.partnerId || req.body?.partner, "partnerId");
    const productId = objectId(req.body?.productId || req.body?.product, "productId");
    const [context, partner, product] = await Promise.all([
      getPartnerApplicationContext(applicationType, applicationId),
      requirePartner(partnerId),
      PartnerProduct.findOne({
        _id: productId,
        isDeleted: false,
        active: true,
        assignmentEnabled: true,
      }),
    ]);
    if (!product) {
      const catalogProductExists = await PartnerProduct.exists({
        _id: productId,
        isDeleted: false,
      });
      if (!catalogProductExists) {
        throw new ApiError(404, "Partner product not found");
      }
      throw new ApiError(
        400,
        "Selected product is inactive or catalog-only and is not enabled for assignment",
      );
    }
    if (partner.status !== PartnerStatus.ACTIVE) {
      throw new ApiError(400, "Only active partners can receive assignments");
    }
    if (String(product.partner) !== String(partner._id)) {
      throw new ApiError(400, "Selected product does not belong to the selected partner");
    }
    const requiredCategory =
      applicationType === PartnerApplicationType.LOAN
        ? PartnerProductCategory.LOAN
        : PartnerProductCategory.INSURANCE;
    if (product.category !== requiredCategory) {
      throw new ApiError(
        400,
        `${applicationType} applications require a ${requiredCategory} product`,
      );
    }
    const status = enumValue(
      req.body?.status,
      Object.values(PartnerAssignmentStatus),
      "status",
    );
    const result = await createDedupedAssignment({
      context,
      partnerId,
      productId,
      mode: PartnerAssignmentMode.MANUAL,
      status,
      externalApplicationId: req.body?.externalApplicationId,
      note: String(req.body?.note || "Manual partner assignment created").trim(),
      actor: userId(req),
    });
    return res.status(result.created ? 201 : 200).json(
      new ApiResponse(
        result.created ? 201 : 200,
        result,
        result.created
          ? "Partner assignment created successfully"
          : "Existing partner assignment returned",
      ),
    );
  }

  static async updateAssignmentStatus(req: Request, res: Response) {
    const id = objectId(req.params.id, "assignment id");
    const status = enumValue(
      req.body?.status,
      Object.values(PartnerAssignmentStatus),
      "status",
      true,
    ) as PartnerAssignmentStatus;
    const assignment = await PartnerAssignment.findById(id);
    if (!assignment) throw new ApiError(404, "Partner assignment not found");
    if (assignment.status === status) {
      return res.status(200).json(
        new ApiResponse(
          200,
          await populateAssignment(assignment._id),
          "Partner assignment status is unchanged",
        ),
      );
    }
    if (
      assignment.applicationType === PartnerApplicationType.LOAN &&
      status === PartnerAssignmentStatus.POLICY_ISSUED
    ) {
      throw new ApiError(400, "Loan assignments cannot be marked policy issued");
    }
    if (
      assignment.applicationType === PartnerApplicationType.INSURANCE &&
      status === PartnerAssignmentStatus.DISBURSED
    ) {
      throw new ApiError(400, "Insurance assignments cannot be marked disbursed");
    }
    if (!isPartnerAssignmentTransitionAllowed(assignment.status, status)) {
      throw new ApiError(
        409,
        `Cannot move partner assignment from ${assignment.status} to ${status}`,
      );
    }
    const now = new Date();
    const previous = assignment.status;
    assignment.status = status;
    assignment.updatedBy = userId(req) && mongoose.isValidObjectId(userId(req))
      ? new Types.ObjectId(userId(req))
      : undefined;
    if (req.body?.externalApplicationId !== undefined) {
      assignment.externalApplicationId = String(req.body.externalApplicationId || "").trim();
    }
    const timestampField: Partial<Record<PartnerAssignmentStatus, keyof typeof assignment>> = {
      [PartnerAssignmentStatus.SENT]: "sentAt",
      [PartnerAssignmentStatus.ACCEPTED]: "acceptedAt",
      [PartnerAssignmentStatus.REJECTED]: "rejectedAt",
      [PartnerAssignmentStatus.APPROVED]: "approvedAt",
      [PartnerAssignmentStatus.DISBURSED]: "disbursedAt",
      [PartnerAssignmentStatus.POLICY_ISSUED]: "policyIssuedAt",
    };
    const field = timestampField[status];
    if (field) (assignment as any)[field] = now;
    if (
      [
        PartnerAssignmentStatus.REJECTED,
        PartnerAssignmentStatus.APPROVED,
        PartnerAssignmentStatus.DISBURSED,
        PartnerAssignmentStatus.POLICY_ISSUED,
      ].includes(status)
    ) {
      assignment.decisionAt ||= now;
    }
    assignment.auditHistory.push({
      fromStatus: previous,
      toStatus: status,
      note: String(req.body?.note || "").trim(),
      actor: assignment.updatedBy,
      metadata:
        req.body?.metadata && typeof req.body.metadata === "object"
          ? req.body.metadata
          : {},
      createdAt: now,
    });
    await assignment.save();
    return res.status(200).json(
      new ApiResponse(
        200,
        await populateAssignment(assignment._id),
        "Partner assignment status updated successfully",
      ),
    );
  }

  static async list(req: Request, res: Response) {
    const { page, limit, skip } = parsePagination(req);
    const type = enumValue(req.query.type, Object.values(PartnerType), "type");
    const status = enumValue(
      req.query.status,
      Object.values(PartnerStatus),
      "status",
    );
    const integrationStatus = enumValue(
      req.query.integrationStatus,
      Object.values(PartnerIntegrationStatus),
      "integrationStatus",
    );
    const category = enumValue(
      req.query.category,
      Object.values(PartnerProductCategory),
      "category",
    );
    const search = String(req.query.search || "").trim();
    const filter: Record<string, any> = {
      ...(booleanValue(req.query.includeDeleted, false) ? {} : { isDeleted: false }),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(integrationStatus ? { integrationStatus } : {}),
      ...(category ? { productCategories: category } : {}),
      ...(req.query.featured !== undefined
        ? { featured: booleanValue(req.query.featured) }
        : {}),
      ...(search
        ? {
            $or: [
              { name: { $regex: escapeRegex(search), $options: "i" } },
              { slug: { $regex: escapeRegex(search), $options: "i" } },
              { "contacts.name": { $regex: escapeRegex(search), $options: "i" } },
            ],
          }
        : {}),
    };
    const [partners, total] = await Promise.all([
      Partner.find(filter)
        .sort({ priority: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Partner.countDocuments(filter),
    ]);
    const ids = partners.map((partner) => partner._id);
    const [productCounts, credentialPartnerIds] = ids.length
      ? await Promise.all([
          PartnerProduct.aggregate([
          { $match: { partner: { $in: ids }, isDeleted: false } },
          {
            $group: {
              _id: "$partner",
              total: { $sum: 1 },
              active: { $sum: { $cond: ["$active", 1, 0] } },
            },
          },
          ]),
          PartnerCredential.find({
            partner: { $in: ids },
            "credentialKeys.0": { $exists: true },
          }).distinct("partner"),
        ])
      : [[], []];
    const countMap = new Map(productCounts.map((item) => [String(item._id), item]));
    const credentialSet = new Set(
      credentialPartnerIds.map((id) => String(id)),
    );
    const items = partners.map((partner) => ({
      ...partner,
      hasCredentials: credentialSet.has(String(partner._id)),
      productCount: Number(countMap.get(String(partner._id))?.total || 0),
      activeProductCount: Number(countMap.get(String(partner._id))?.active || 0),
    }));
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          items,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
        "Partners fetched successfully",
      ),
    );
  }

  static async create(req: Request, res: Response) {
    const payload = buildPartnerPayload(req.body || {}, true);
    try {
      const partner = await Partner.create(payload);
      return res
        .status(201)
        .json(new ApiResponse(201, partner, "Partner created successfully"));
    } catch (error) {
      return duplicateError(error, "A partner with this slug already exists");
    }
  }

  static async detail(req: Request, res: Response) {
    const partner = await requirePartner(req.params.id, true);
    const [productStats, assignmentStats, hasCredentials] = await Promise.all([
      PartnerProduct.aggregate([
        { $match: { partner: partner._id, isDeleted: false } },
        {
          $group: {
            _id: "$category",
            total: { $sum: 1 },
            active: { $sum: { $cond: ["$active", 1, 0] } },
          },
        },
      ]),
      PartnerAssignment.aggregate([
        { $match: { partner: partner._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      PartnerCredential.exists({
        partner: partner._id,
        "credentialKeys.0": { $exists: true },
      }),
    ]);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ...partner.toObject(),
          hasCredentials: Boolean(hasCredentials),
          statistics: {
            products: productStats.map((item) => ({
              category: item._id,
              total: item.total,
              active: item.active,
            })),
            assignments: Object.fromEntries(
              assignmentStats.map((item) => [item._id, item.count]),
            ),
          },
        },
        "Partner fetched successfully",
      ),
    );
  }

  static async update(req: Request, res: Response) {
    const id = objectId(req.params.id, "partner id");
    const payload = buildPartnerPayload(req.body || {}, false);
    try {
      const partner = await Partner.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $set: payload },
        { new: true, runValidators: true },
      );
      if (!partner) throw new ApiError(404, "Partner not found");
      return res
        .status(200)
        .json(new ApiResponse(200, partner, "Partner updated successfully"));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return duplicateError(error, "A partner with this slug already exists");
    }
  }

  static async remove(req: Request, res: Response) {
    const id = objectId(req.params.id, "partner id");
    const actor = userId(req);
    const partner = await Partner.findOneAndUpdate(
      { _id: id, isDeleted: false },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: actor && mongoose.isValidObjectId(actor) ? actor : null,
          status: PartnerStatus.INACTIVE,
        },
      },
      { new: true },
    );
    if (!partner) throw new ApiError(404, "Partner not found");
    return res.status(200).json(
      new ApiResponse(
        200,
        { id: partner._id, isDeleted: true },
        "Partner deleted successfully",
      ),
    );
  }

  static async getCredentials(req: Request, res: Response) {
    const partner = await requirePartner(req.params.id);
    const credential = await PartnerCredential.findOne({ partner: partner._id })
      .lean();
    if (!credential) {
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            configured: false,
            hasCredentials: false,
            partner: { _id: partner._id, name: partner.name, slug: partner.slug },
            provider: "",
            baseUrl: "",
            authType: PartnerCredentialAuthType.NONE,
            credentialKeys: [],
          },
          "Partner credentials are not configured",
        ),
      );
    }
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          configured: true,
          hasCredentials: credential.credentialKeys.length > 0,
          partner: { _id: partner._id, name: partner.name, slug: partner.slug },
          provider: credential.provider,
          baseUrl: credential.baseUrl || "",
          authType: credential.authType,
          credentialKeys: credential.credentialKeys,
          lastTestedAt: credential.lastTestedAt || null,
          lastTestSucceeded: credential.lastTestSucceeded ?? null,
          lastTestStatusCode: credential.lastTestStatusCode ?? null,
          lastTestMessage: credential.lastTestMessage || "",
          updatedAt: credential.updatedAt,
        },
        "Partner credentials fetched successfully",
      ),
    );
  }

  static async updateCredentials(req: Request, res: Response) {
    const partner = await requirePartner(req.params.id);
    const provider = String(req.body?.provider || "").trim();
    if (!provider) throw new ApiError(400, "provider is required");
    const authType = enumValue(
      req.body?.authType,
      Object.values(PartnerCredentialAuthType),
      "authType",
      true,
    ) as PartnerCredentialAuthType;
    const baseUrl = assertPartnerApiBaseUrl(req.body?.baseUrl);
    if (
      req.body?.credentials !== undefined &&
      (!req.body.credentials ||
        typeof req.body.credentials !== "object" ||
        Array.isArray(req.body.credentials))
    ) {
      throw new ApiError(400, "credentials must be a JSON object");
    }
    const existing = await PartnerCredential.findOne({ partner: partner._id })
      .select(encryptedCredentialSelection)
      .exec();
    const submittedCredentials =
      req.body?.credentials && typeof req.body.credentials === "object"
        ? req.body.credentials
        : {};
    const previousCredentials =
      existing?.encryptedCredentials &&
      !booleanValue(req.body?.replaceCredentials, false)
        ? decryptPartnerCredentials(existing.encryptedCredentials)
        : {};
    const nonBlankSubmitted = Object.fromEntries(
      Object.entries(submittedCredentials).filter(([, value]) => {
        if (value === undefined || value === null) return false;
        if (typeof value === "string") return value.trim() !== "";
        return true;
      }),
    );
    const mergedCredentials: Record<string, unknown> = {
      ...previousCredentials,
      ...nonBlankSubmitted,
    };
    for (const key of stringList(
      req.body?.removedCredentialKeys,
      "removedCredentialKeys",
    )) {
      delete mergedCredentials[key];
    }
    const { credentials, credentialKeys } = validatePartnerCredentialPayload(
      authType,
      mergedCredentials,
    );
    const encryptedCredentials = encryptPartnerCredentials(credentials);
    const actor = userId(req);
    const credential = await PartnerCredential.findOneAndUpdate(
      { partner: partner._id },
      {
        $set: {
          provider,
          baseUrl,
          authType,
          encryptedCredentials,
          credentialKeys,
          updatedBy:
            actor && mongoose.isValidObjectId(actor) ? new Types.ObjectId(actor) : null,
        },
        $unset: {
          lastTestedAt: 1,
          lastTestSucceeded: 1,
          lastTestStatusCode: 1,
          lastTestMessage: 1,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    await Partner.updateOne(
      { _id: partner._id },
      {
        $set: {
          integrationStatus: PartnerIntegrationStatus.CONFIGURED,
          integrationMessage: "Credentials configured; connectivity test pending",
        },
        $unset: { integrationLastCheckedAt: 1 },
      },
    );
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          configured: true,
          hasCredentials: credentialKeys.length > 0,
          provider: credential.provider,
          baseUrl: credential.baseUrl || "",
          authType: credential.authType,
          credentialKeys,
          updatedAt: credential.updatedAt,
        },
        "Partner credentials encrypted and saved successfully",
      ),
    );
  }

  static async testCredentials(req: Request, res: Response) {
    const partner = await requirePartner(req.params.id);
    const credential = await PartnerCredential.findOne({ partner: partner._id })
      .select(encryptedCredentialSelection)
      .exec();
    if (!credential) throw new ApiError(404, "Partner credentials are not configured");
    if (!credential.baseUrl) throw new ApiError(400, "Partner baseUrl is not configured");
    if (!credential.encryptedCredentials) {
      throw new ApiError(500, "Encrypted partner credentials are missing");
    }
    const decrypted = decryptPartnerCredentials(credential.encryptedCredentials);
    validatePartnerCredentialPayload(credential.authType, decrypted);
    const result = await testPartnerConnectivity(credential.baseUrl);
    const checkedAt = new Date();
    credential.lastTestedAt = checkedAt;
    credential.lastTestSucceeded = result.reachable;
    credential.lastTestStatusCode = result.statusCode;
    credential.lastTestMessage = result.message;
    await credential.save();
    await Partner.updateOne(
      { _id: partner._id },
      {
        $set: {
          integrationStatus: result.reachable
            ? PartnerIntegrationStatus.CONNECTED
            : PartnerIntegrationStatus.ERROR,
          integrationLastCheckedAt: checkedAt,
          integrationMessage: result.message,
        },
      },
    );
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          configured: true,
          hasCredentials: credential.credentialKeys.length > 0,
          credentialsValid: true,
          reachable: result.reachable,
          statusCode: result.statusCode ?? null,
          latencyMs: result.latencyMs,
          message: result.message,
          checkedAt,
          note: "Connectivity tests never transmit saved credentials",
        },
        result.reachable
          ? "Partner API connectivity test passed"
          : "Partner credential configuration is valid, but the API is unreachable",
      ),
    );
  }
}
