import mongoose from "mongoose";
import { config } from "../config/config";
import { Agency } from "../modals/agency.model";
import { UserStatus } from "../modals/user.model";
import { AgencyCommissionTransaction } from "../modals/agencyCommissionTransaction.model";
import { AgencyPayoutRequest } from "../modals/agencyPayoutRequest.model";
import { AgencyPayoutProfile } from "../modals/agencyPayoutProfile.model";
import { agencyPayoutProfileService } from "../services/agencyPayoutProfile.service";
import { LoanQuery } from "../modals/loanquery.model";
import { InsuranceQuery } from "../modals/insurancequery.model";

const referralCodeFor = (agencyId: string) =>
  `DSA${String(agencyId || "").replace(/[^a-z0-9]/gi, "").slice(-8)}`.toUpperCase();

const migrate = async () => {
  if (!config.db.url) throw new Error("DB_URL is required");
  if (!config.dsa.payoutEncryptionKey) {
    throw new Error("DSA_PAYOUT_ENCRYPTION_KEY is required for this migration");
  }
  await mongoose.connect(config.db.url, config.db.name ? { dbName: config.db.name } : {});

  let agenciesUpdated = 0;
  let payoutProfilesCreated = 0;
  let payoutRequestsSanitized = 0;
  let commissionDuplicateGroups = 0;
  let commissionRowsSuperseded = 0;
  let commissionPaidConflictGroups = 0;

  const agencies = await Agency.find({ role: "agency" }).select(
    "+bankDetails agencyId referralCode status approvalReview",
  );
  for (const agency of agencies) {
    const updates: Record<string, any> = {};
    if (!agency.referralCode && agency.agencyId) {
      updates.referralCode = referralCodeFor(agency.agencyId);
    }
    if (
      agency.status === UserStatus.ACTIVE &&
      agency.approvalReview?.status !== "rejected" &&
      agency.approvalReview?.status !== "approved"
    ) {
      updates["approvalReview.status"] = "approved";
      updates["approvalReview.reviewedAt"] =
        (agency as any).updatedAt || (agency as any).createdAt || new Date();
      updates["approvalReview.notes"] = "Legacy active DSA approval inferred by migration";
    }
    if (Object.keys(updates).length) {
      await Agency.updateOne({ _id: agency._id }, { $set: updates });
      agenciesUpdated += 1;
    }
  }

  await AgencyCommissionTransaction.updateMany(
    { earningStatus: "paid", $or: [{ paidAmount: { $exists: false } }, { paidAmount: 0 }] },
    [{ $set: { paidAmount: "$commissionAmount", accrualStage: { $ifNull: ["$accrualStage", "disbursed"] } } }],
  );
  await AgencyCommissionTransaction.updateMany(
    { earningStatus: "earned", paidAmount: { $exists: false } },
    { $set: { paidAmount: 0 } },
  );

  const duplicateCommissionGroups = await AgencyCommissionTransaction.aggregate([
    {
      $group: {
        _id: { queryType: "$queryType", queryRef: "$queryRef" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  const statusRank: Record<string, number> = {
    clawback_required: 5,
    paid: 4,
    earned: 3,
    pending: 2,
    reversed: 1,
  };
  for (const group of duplicateCommissionGroups) {
    const rows: any[] = await AgencyCommissionTransaction.find({
      queryType: group._id.queryType,
      queryRef: group._id.queryRef,
    })
      .select("earningStatus paidAmount")
      .lean();
    const paidRows = rows.filter(
      (row) => row.earningStatus === "paid" || Number(row.paidAmount || 0) > 0,
    );
    if (paidRows.length > 1) commissionPaidConflictGroups += 1;
  }
  if (commissionPaidConflictGroups > 0) {
    throw new Error(
      `DSA commission migration stopped: ${commissionPaidConflictGroups} duplicate application group(s) contain multiple paid rows and require manual financial reconciliation`,
    );
  }
  for (const group of duplicateCommissionGroups) {
    const rows: any[] = await AgencyCommissionTransaction.find({
      queryType: group._id.queryType,
      queryRef: group._id.queryRef,
    }).lean();
    rows.sort((left, right) => {
      const leftRank = statusRank[String(left.earningStatus)] || 0;
      const rightRank = statusRank[String(right.earningStatus)] || 0;
      if (leftRank !== rightRank) return rightRank - leftRank;
      const paidDelta = Number(right.paidAmount || 0) - Number(left.paidAmount || 0);
      if (paidDelta) return paidDelta;
      const updatedDelta = new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
      if (updatedDelta) return updatedDelta;
      return String(left._id).localeCompare(String(right._id));
    });
    const canonical = rows[0];
    if (!canonical) continue;
    await AgencyCommissionTransaction.updateMany(
      { _id: { $in: rows.map((row) => row._id) } },
      { $set: { isCanonical: false } },
    );
    await AgencyCommissionTransaction.updateOne(
      { _id: canonical._id },
      { $set: { isCanonical: true } },
    );
    if (group._id.queryType === "loan") {
      await LoanQuery.updateOne(
        { _id: group._id.queryRef },
        { $set: { agencyCommissionTransactionId: canonical._id } },
      );
    } else if (group._id.queryType === "insurance") {
      await InsuranceQuery.updateOne(
        { _id: group._id.queryRef },
        { $set: { agencyCommissionTransactionId: canonical._id } },
      );
    }
    commissionDuplicateGroups += 1;
    commissionRowsSuperseded += Math.max(0, rows.length - 1);
  }
  await AgencyCommissionTransaction.updateMany(
    { isCanonical: { $exists: false } },
    { $set: { isCanonical: true } },
  );

  const commissionIndexes = await AgencyCommissionTransaction.collection.indexes();
  if (commissionIndexes.some((index) => index.name === "agency_query_unique_commission")) {
    await AgencyCommissionTransaction.collection.dropIndex("agency_query_unique_commission");
  }
  await AgencyCommissionTransaction.collection.createIndex(
    { queryType: 1, queryRef: 1 },
    {
      unique: true,
      partialFilterExpression: { isCanonical: true },
      name: "canonical_query_unique_commission",
    },
  );

  const legacyRequests = await AgencyPayoutRequest.find({
    $or: [
      { upiId: { $exists: true, $nin: [null, ""] } },
      { "bankDetails.accountNumber": { $exists: true, $nin: [null, ""] } },
    ],
  }).select("+upiId +bankDetails ownerAgency method status createdAt");

  legacyRequests.sort((left: any, right: any) => {
    const leftActive = ["pending", "approved", "processing"].includes(left.status) ? 1 : 0;
    const rightActive = ["pending", "approved", "processing"].includes(right.status) ? 1 : 0;
    if (leftActive !== rightActive) return leftActive - rightActive;
    return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
  });

  for (const request of legacyRequests) {
    let profile: any;
    try {
      await agencyPayoutProfileService.upsert({
        agencyId: String(request.ownerAgency),
        method: request.method,
        upiId: request.upiId,
        accountNumber: request.bankDetails?.accountNumber,
        ifsc: request.bankDetails?.ifsc,
        accountHolder: request.bankDetails?.accountHolder,
        bankName: request.bankDetails?.bankName,
        updatedBy: String(request.ownerAgency),
        allowActiveReservation: true,
      });
      profile = await AgencyPayoutProfile.findOne({
        agency: request.ownerAgency,
      }).select("+encryptedPayload").lean();
      payoutProfilesCreated += 1;
    } catch {
      // Keep legacy destination untouched if encryption/validation fails.
      continue;
    }
    if (!profile?.encryptedPayload) continue;
    await AgencyPayoutRequest.updateOne(
      { _id: request._id },
      {
        $set: {
          payoutProfile: profile._id,
          destinationEncryptedSnapshot: profile.encryptedPayload,
          destinationMasked: profile.maskedDestination,
          ...(["pending", "approved", "processing"].includes(request.status)
            ? {}
            : { reservationActive: false }),
        },
        $unset: { upiId: "", bankDetails: "" },
      },
    );
    payoutRequestsSanitized += 1;
  }

  const activeOwners = await AgencyPayoutRequest.distinct("ownerAgency", {
    status: { $in: ["pending", "approved", "processing"] },
  });
  for (const ownerAgency of activeOwners) {
    const requests = await AgencyPayoutRequest.find({
      ownerAgency,
      status: { $in: ["pending", "approved", "processing"] },
    })
      .sort({ createdAt: 1 })
      .select("_id");
    if (!requests.length) continue;
    await AgencyPayoutRequest.updateMany(
      { _id: { $in: requests.map((item) => item._id) } },
      { $unset: { reservationActive: "" } },
    );
    await AgencyPayoutRequest.updateOne(
      { _id: requests[0]._id },
      { $set: { reservationActive: true } },
    );
  }
  await AgencyPayoutRequest.updateMany(
    { status: { $in: ["paid", "failed", "rejected"] } },
    { $set: { reservationActive: false } },
  );

  // Optional: remove legacy Agency.bankDetails only after an encrypted profile
  // exists. Disabled by default because bankDetails may also contain KYC evidence.
  if (process.env.DSA_MIGRATION_UNSET_LEGACY_BANK === "true") {
    const profileAgencyIds = await AgencyPayoutProfile.distinct("agency");
    await Agency.updateMany(
      { _id: { $in: profileAgencyIds }, bankDetails: { $exists: true } },
      { $unset: { bankDetails: "" } },
    );
  }

  console.info("DSA migration complete", {
    agenciesUpdated,
    payoutProfilesCreated,
    payoutRequestsSanitized,
    commissionDuplicateGroups,
    commissionRowsSuperseded,
    commissionPaidConflictGroups,
  });
};

migrate()
  .catch((error) => {
    console.error("DSA migration failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
