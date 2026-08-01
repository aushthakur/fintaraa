import crypto from "crypto";
import Admin from "../modals/admin.model";
import {
  ApplicationDocumentReview,
  ApplicationDocumentReviewCustomerModel,
  ApplicationDocumentReviewCustomerRole,
  ApplicationDocumentReviewStatus,
} from "../modals/applicationDocumentReview.model";
import { Agency } from "../modals/agency.model";
import { LoanQuery } from "../modals/loanquery.model";
import { UserType } from "../modals/notification.model";
import { sendSingleNotification } from "./notification.service";

let backfillPromise: Promise<void> | null = null;
let backfillCompleted = false;

type ReviewEntry = { documentKey: string; fileUrl: string };
type ReviewOwner = {
  customer: any;
  customerModel: ApplicationDocumentReviewCustomerModel;
  customerRole: ApplicationDocumentReviewCustomerRole;
};

const idString = (value: any) =>
  String(value?._id || value || "").trim();

export const normalizeApplicationDocumentReviewRole = (
  value: unknown,
): ApplicationDocumentReviewCustomerRole | null => {
  const role = String(value || "").trim().toLowerCase();
  return role === UserType.USER ||
    role === UserType.AGENCY ||
    role === UserType.AGENCY_MEMBER
    ? (role as ApplicationDocumentReviewCustomerRole)
    : null;
};

export const buildApplicationDocumentReviewOwnershipFilter = ({
  applicationId,
  customerId,
  customerRole,
}: {
  applicationId: any;
  customerId: any;
  customerRole: ApplicationDocumentReviewCustomerRole;
}) => ({
  _id: applicationId,
  ...(customerRole === UserType.USER
    ? { customerId }
    : {
        $or: [
          { customerId },
          { channelAgency: customerId },
          { ownerAgency: customerId },
        ],
      }),
});

const ownerForRole = (
  customer: any,
  customerRole: ApplicationDocumentReviewCustomerRole,
): ReviewOwner => ({
  customer,
  customerModel:
    customerRole === UserType.USER
      ? ApplicationDocumentReviewCustomerModel.USER
      : ApplicationDocumentReviewCustomerModel.AGENCY,
  customerRole,
});

const resolveReviewOwner = async (
  query: any,
  agencyRoleCache?: Map<string, ApplicationDocumentReviewCustomerRole | null>,
): Promise<ReviewOwner | null> => {
  const customer = query?.customerId?._id || query?.customerId;
  const customerId = idString(customer);
  if (!customerId) return null;

  const explicitRole = normalizeApplicationDocumentReviewRole(
    query?.customerRole,
  );
  if (explicitRole) return ownerForRole(customer, explicitRole);

  const createdByRole = normalizeApplicationDocumentReviewRole(
    query?.createdByRole,
  );
  const looksLikeAgencyOwner =
    createdByRole === UserType.AGENCY ||
    createdByRole === UserType.AGENCY_MEMBER ||
    String(query?.dataSource || "").trim().toLowerCase() === "b2b_app" ||
    idString(query?.channelAgency) === customerId ||
    idString(query?.ownerAgency) === customerId;

  if (looksLikeAgencyOwner) {
    let agencyRole = agencyRoleCache?.get(customerId);
    if (agencyRole === undefined) {
      const agency = await Agency.findById(customer)
        .select("role")
        .lean();
      agencyRole = normalizeApplicationDocumentReviewRole(agency?.role);
      agencyRoleCache?.set(customerId, agencyRole);
    }
    if (
      agencyRole === UserType.AGENCY ||
      agencyRole === UserType.AGENCY_MEMBER
    ) {
      return ownerForRole(customer, agencyRole);
    }
  }

  return ownerForRole(customer, UserType.USER);
};

const collectUrls = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")
      ? [trimmed]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectUrls);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (typeof source.url === "string") return collectUrls(source.url);
    if (typeof source.fileUrl === "string") return collectUrls(source.fileUrl);
    return Object.values(source).flatMap(collectUrls);
  }
  return [];
};

export const collectApplicationDocumentReviewEntries = (
  query: any,
  onlyKeys?: string[],
) => {
  const selected = onlyKeys?.length ? new Set(onlyKeys) : null;
  const entries: ReviewEntry[] = [];
  const addCatalogDocuments = (value: unknown) => {
    if (!Array.isArray(value)) return;
    value.forEach((item: any) => {
      if (!item || typeof item !== "object") return;
      const documentKey = String(
        item.catalogKey || item.key || item.label || "catalog_documents",
      ).trim();
      if (!documentKey) return;
      if (
        selected &&
        !selected.has("catalog_documents") &&
        !selected.has(documentKey)
      ) {
        return;
      }
      collectUrls(item.files || item.fileUrl || item.url).forEach((fileUrl) =>
        entries.push({ documentKey, fileUrl }),
      );
    });
  };
  const addSource = (source: unknown, prefix = "") => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
      if (!prefix && key === "catalog_documents") {
        addCatalogDocuments(value);
        return;
      }
      const documentKey = prefix ? `${prefix}.${key}` : key;
      if (selected && !selected.has(key) && !selected.has(documentKey)) return;
      collectUrls(value).forEach((fileUrl) =>
        entries.push({ documentKey, fileUrl }),
      );
    });
  };
  addSource(query.documents);
  addSource(query.policyDetails, "policyDetails");
  if ((!selected || selected.has("bankStatementUrl")) && query.bankStatementUrl) {
    collectUrls(query.bankStatementUrl).forEach((fileUrl) =>
      entries.push({ documentKey: "bankStatementUrl", fileUrl }),
    );
  }
  return entries;
};

const reviewUpsert = (
  query: any,
  entry: ReviewEntry,
  uploadedAt: Date,
  owner: ReviewOwner,
) => ({
  updateOne: {
    filter: {
      application: query._id,
      documentKey: entry.documentKey,
      fileUrlHash: crypto
        .createHash("sha256")
        .update(entry.fileUrl)
        .digest("hex"),
    },
    update: {
      $set: {
        customer: owner.customer,
        customerModel: owner.customerModel,
        customerRole: owner.customerRole,
      },
      $setOnInsert: {
        fileUrl: entry.fileUrl,
        status: ApplicationDocumentReviewStatus.PENDING,
        uploadedAt,
      },
    },
    upsert: true,
  },
});

const notifyAdmins = async (query: any, entries: ReviewEntry[]) => {
  const assignedIds = Array.from(
    new Set(
      [query.assignedAgent, ...(query.assignedAgents || [])]
        .map((value) => String(value?._id || value || "").trim())
        .filter(Boolean),
    ),
  );
  const adminIds = assignedIds.length
    ? assignedIds
    : (
        await Admin.find({ status: true })
          .select("_id")
          .sort({ createdAt: 1 })
          .limit(20)
          .lean()
      ).map((admin) => String(admin._id));
  await Promise.allSettled(
    adminIds.map((adminId) =>
      sendSingleNotification({
        type: "loan-document-review-pending",
        toUserId: adminId,
        toRole: UserType.ADMIN,
        context: {
          loanId: query.loanId || String(query._id),
          name:
            `${query.firstName || ""} ${query.lastName || ""}`.trim() ||
            "Customer",
          documents: entries.map((entry) => entry.documentKey).join(", "),
          url: "/dashboard/document-reviews",
        },
      }),
    ),
  );
};

export const syncApplicationDocumentReviews = async (
  queryOrId: any,
  options?: { onlyKeys?: string[]; notifyAdmins?: boolean },
) => {
  const query =
    typeof queryOrId === "string" || queryOrId?._bsontype
      ? await LoanQuery.findById(queryOrId)
          .select(
            "customerId channelAgency ownerAgency createdByRole dataSource loanId loanType firstName lastName documents policyDetails bankStatementUrl assignedAgent assignedAgents",
          )
          .lean()
      : queryOrId;
  if (!query?._id || !query?.customerId) return [];
  const entries = collectApplicationDocumentReviewEntries(
    query,
    options?.onlyKeys,
  );
  if (!entries.length) return [];
  const owner = await resolveReviewOwner(query);
  if (!owner) return [];
  const now = new Date();
  await ApplicationDocumentReview.bulkWrite(
    entries.map((entry) => reviewUpsert(query, entry, now, owner)),
    { ordered: false },
  );

  if (options?.notifyAdmins) {
    await notifyAdmins(query, entries);
  }
  return entries;
};

export const syncApplicationDocumentReviewUpload = async ({
  applicationId,
  customerId,
  customerRole,
  documentKey,
  fileUrl,
  notify = false,
}: {
  applicationId: any;
  customerId: any;
  customerRole: ApplicationDocumentReviewCustomerRole;
  documentKey: string;
  fileUrl: string;
  notify?: boolean;
}) => {
  const normalizedKey = String(documentKey || "").trim();
  const normalizedUrl = collectUrls(fileUrl)[0];
  const normalizedRole = normalizeApplicationDocumentReviewRole(customerRole);
  if (!normalizedKey || !normalizedUrl || !normalizedRole) return null;

  const query = await LoanQuery.findOne(
    buildApplicationDocumentReviewOwnershipFilter({
      applicationId,
      customerId,
      customerRole: normalizedRole,
    }),
  )
    .select(
      "customerId channelAgency ownerAgency loanId loanType firstName lastName assignedAgent assignedAgents",
    )
    .lean();
  if (!query) return null;

  const entry = { documentKey: normalizedKey, fileUrl: normalizedUrl };
  const owner = ownerForRole(customerId, normalizedRole);
  const uploadedAt = new Date();
  await ApplicationDocumentReview.bulkWrite(
    [reviewUpsert(query, entry, uploadedAt, owner)],
    { ordered: false },
  );
  if (notify) await notifyAdmins(query, [entry]);

  return ApplicationDocumentReview.findOne({
    application: query._id,
    documentKey: normalizedKey,
    fileUrlHash: crypto
      .createHash("sha256")
      .update(normalizedUrl)
      .digest("hex"),
  }).lean();
};

export const backfillApplicationDocumentReviews = async () => {
  if (backfillCompleted) return;
  if (backfillPromise) return backfillPromise;
  backfillPromise = (async () => {
    const cursor = LoanQuery.find({
      $or: [
        { documents: { $exists: true, $ne: {} } },
        { bankStatementUrl: { $exists: true, $nin: ["", null] } },
        { policyDetails: { $exists: true, $ne: {} } },
      ],
    })
      .select(
        "customerId channelAgency ownerAgency createdByRole dataSource documents policyDetails bankStatementUrl loanId loanType firstName lastName",
      )
      .sort({ _id: 1 })
      .lean()
      .cursor({ batchSize: 200 });
    let operations: any[] = [];
    const agencyRoleCache = new Map<
      string,
      ApplicationDocumentReviewCustomerRole | null
    >();
    for await (const query of cursor) {
      const uploadedAt = new Date();
      const owner = await resolveReviewOwner(query, agencyRoleCache);
      if (!owner) continue;
      operations.push(
        ...collectApplicationDocumentReviewEntries(query).map((entry) =>
          reviewUpsert(query, entry, uploadedAt, owner),
        ),
      );
      if (operations.length >= 500) {
        await ApplicationDocumentReview.bulkWrite(operations, {
          ordered: false,
        });
        operations = [];
      }
    }
    if (operations.length) {
      await ApplicationDocumentReview.bulkWrite(operations, {
        ordered: false,
      });
    }
    backfillCompleted = true;
  })().finally(() => {
    backfillPromise = null;
  });
  return backfillPromise;
};
