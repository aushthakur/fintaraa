import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import {
  isDocumentRequestFulfilled,
  mergeUploadedDocumentEvidence,
  normalizeRequestedDocuments,
  resolveRequestedDocument,
  validateDocumentFileUrl,
} from "../services/documentRequest.service";
import {
  appendLeadSourceHistory,
  preserveFirstTouchAttribution,
} from "../services/leadManagement.service";
import {
  buildApplicationDocumentReviewOwnershipFilter,
  collectApplicationDocumentReviewEntries,
  normalizeApplicationDocumentReviewRole,
} from "../services/applicationDocumentReview.service";
import {
  ApplicationDocumentReview,
  ApplicationDocumentReviewCustomerModel,
} from "../modals/applicationDocumentReview.model";
import { InsuranceQuery } from "../modals/insurancequery.model";
import {
  buildLeadOwnershipMatch,
  canAccessLeadRecord,
} from "../admin/lead/leadAccess.middleware";

test("document requests normalize labels and require safe uploaded URLs", () => {
  assert.deepEqual(
    normalizeRequestedDocuments([
      " PAN Card ",
      "pan-card",
      "Bank Statement",
      "",
    ]),
    ["PAN Card", "Bank Statement"],
  );
  assert.equal(
    resolveRequestedDocument(["PAN Card"], "pan_card"),
    "PAN Card",
  );
  assert.equal(
    validateDocumentFileUrl("https://files.example.com/pan.pdf"),
    "https://files.example.com/pan.pdf",
  );
  assert.equal(validateDocumentFileUrl("data:text/plain,secret"), null);
  assert.equal(validateDocumentFileUrl("https://user:pass@example.com/a"), null);
});

test("multi-document requests stay pending until every file has evidence", () => {
  const first = mergeUploadedDocumentEvidence([], {
    documentKey: "PAN Card",
    fileUrl: "https://files.example.com/pan.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(
    isDocumentRequestFulfilled(["PAN Card", "Bank Statement"], first),
    false,
  );
  const complete = mergeUploadedDocumentEvidence(first, {
    documentKey: "Bank Statement",
    fileUrl: "https://files.example.com/bank.pdf",
    uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(
    isDocumentRequestFulfilled(["PAN Card", "Bank Statement"], complete),
    true,
  );
});

test("application document reviews keep User and Agency ownership separate", () => {
  assert.equal(
    (ApplicationDocumentReview.schema.path("customer") as any).options.refPath,
    "customerModel",
  );
  assert.deepEqual(
    (
      ApplicationDocumentReview.schema.path("customerModel") as any
    ).options.enum,
    Object.values(ApplicationDocumentReviewCustomerModel),
  );
  assert.equal(normalizeApplicationDocumentReviewRole("agency_member"), "agency_member");
  assert.equal(normalizeApplicationDocumentReviewRole("admin"), null);

  assert.deepEqual(
    buildApplicationDocumentReviewOwnershipFilter({
      applicationId: "loan-1",
      customerId: "agency-1",
      customerRole: "agency",
    }),
    {
      _id: "loan-1",
      $or: [
        { customerId: "agency-1" },
        { channelAgency: "agency-1" },
        { ownerAgency: "agency-1" },
      ],
    },
  );
  assert.deepEqual(
    buildApplicationDocumentReviewOwnershipFilter({
      applicationId: "loan-2",
      customerId: "user-1",
      customerRole: "user",
    }),
    { _id: "loan-2", customerId: "user-1" },
  );
});

test("catalog application documents retain their real document identity", () => {
  assert.deepEqual(
    collectApplicationDocumentReviewEntries({
      documents: {
        catalog_documents: [
          {
            key: "bank_statement",
            label: "Bank statement",
            files: [{ url: "https://files.example.com/bank.pdf" }],
          },
          {
            catalogKey: "income_proof",
            files: [
              { url: "https://files.example.com/income-1.pdf" },
              { url: "https://files.example.com/income-2.pdf" },
            ],
          },
        ],
      },
    }),
    [
      {
        documentKey: "bank_statement",
        fileUrl: "https://files.example.com/bank.pdf",
      },
      {
        documentKey: "income_proof",
        fileUrl: "https://files.example.com/income-1.pdf",
      },
      {
        documentKey: "income_proof",
        fileUrl: "https://files.example.com/income-2.pdf",
      },
    ],
  );
});

test("vehicle-insurance applications persist their RC lookup snapshot", () => {
  assert.equal(
    (InsuranceQuery.schema.path("rcLookup") as any)?.instance,
    "Mixed",
  );
});

test("external users cannot enter the staff lead CRM", () => {
  const actorId = new Types.ObjectId();
  assert.equal(
    canAccessLeadRecord({
      actorId,
      actorRole: "user",
      assignedAgentId: actorId,
    }),
    false,
  );
  assert.equal(buildLeadOwnershipMatch(actorId, "user"), null);
});

test("agents cannot access a lead assigned to another employee", () => {
  const actorId = new Types.ObjectId();
  const assignedAgentId = new Types.ObjectId();
  assert.equal(
    canAccessLeadRecord({ actorId, actorRole: "agent", assignedAgentId }),
    false,
  );
  assert.deepEqual(buildLeadOwnershipMatch(actorId, "agent"), {
    "assignment.current.agent": actorId,
  });
});

test("admins retain global lead access and assigned agents retain scoped access", () => {
  const actorId = new Types.ObjectId();
  assert.equal(
    canAccessLeadRecord({
      actorId,
      actorRole: "agent",
      assignedAgentId: actorId,
    }),
    true,
  );
  assert.equal(
    canAccessLeadRecord({
      actorId,
      actorRole: "admin",
      assignedAgentId: undefined,
    }),
    true,
  );
  assert.deepEqual(buildLeadOwnershipMatch(actorId, "admin"), {});
});

test("lead merges preserve first-touch source and append later source history", () => {
  assert.deepEqual(
    preserveFirstTouchAttribution(
      { platform: "website", channel: "loan_application" },
      { platform: "b2c_app", channel: "loan_application", campaignId: "app" },
    ),
    {
      platform: "website",
      channel: "loan_application",
      campaignId: "app",
    },
  );

  const capturedAt = new Date("2026-01-03T00:00:00.000Z");
  const history = appendLeadSourceHistory(
    undefined,
    { platform: "website", channel: "loan_application" },
    { platform: "b2c_app", channel: "loan_application" },
    capturedAt,
    "loan-1",
  );
  assert.deepEqual(
    history.map((entry) => entry.platform),
    ["website", "b2c_app"],
  );
  assert.equal(
    appendLeadSourceHistory(
      history,
      { platform: "website" },
      { platform: "b2c_app" },
      capturedAt,
      "loan-1",
    ).length,
    2,
  );
});
