import { ApplicationStatus } from "../modals/insurancequery.model";
import { ReferralEvent } from "../modals/referralEvent.model";
import { ReferralProgramConfig } from "../modals/referralProgramConfig.model";
import { User } from "../modals/user.model";
import { UserType } from "../modals/notification.model";
import { sendSingleNotification } from "./notification.service";

const POINTS_TO_RUPEE = 100;
export const REFERRAL_DISBURSED_STATUSES = new Set<string>([
  ApplicationStatus.DISBURSED,
  ApplicationStatus.DISBURSED_PARTIAL_FULL,
]);

export const getEligibleReferralDisbursedAmount = (
  loanQuery: any,
  minimumDisbursementAmount: unknown,
): number | null => {
  const status = String(loanQuery?.status || "")
    .trim()
    .toLowerCase();
  if (!REFERRAL_DISBURSED_STATUSES.has(status)) return null;

  // The amount must be explicit. Requested loanAmount is not evidence that
  // any money was actually disbursed.
  if (
    loanQuery?.disbursedAmount === undefined ||
    loanQuery?.disbursedAmount === null ||
    loanQuery?.disbursedAmount === ""
  ) {
    return null;
  }
  const disbursedAmount = Number(loanQuery.disbursedAmount);
  const configuredMinimum = Number(minimumDisbursementAmount);
  const minimum = Number.isFinite(configuredMinimum)
    ? Math.max(configuredMinimum, 0)
    : 0;
  if (!Number.isFinite(disbursedAmount) || disbursedAmount <= 0) return null;
  if (disbursedAmount < minimum) return null;
  return disbursedAmount;
};

export const getReferralProgramConfig = () =>
  ReferralProgramConfig.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $setOnInsert: {
        singletonKey: "default",
        rewardAmount: 500,
        minimumDisbursementAmount: 0,
        isActive: true,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

const findReferralEvent = (userId: string) =>
  ReferralEvent.findOne({ referredUser: userId }).sort({ createdAt: 1 });

export const trackReferralApplication = async (
  userId: string,
  loanQuery?: any,
) => {
  const event = await findReferralEvent(userId);
  if (
    !event ||
    event.status === "rewarded" ||
    event.lifecycleStage === "reward_paid"
  )
    return event;
  if (event.lifecycleStage === "registered") {
    event.lifecycleStage = "applied";
    event.appliedAt = new Date();
  }
  if (loanQuery?._id) event.loanQuery = loanQuery._id;
  await event.save();
  return event;
};

export const trackReferralApproval = async (
  userId: string,
  loanQuery?: any,
) => {
  const event = await findReferralEvent(userId);
  if (
    !event ||
    event.status === "rewarded" ||
    event.lifecycleStage === "reward_paid"
  )
    return event;
  event.lifecycleStage = "approved";
  event.appliedAt = event.appliedAt || new Date();
  event.approvedAt = event.approvedAt || new Date();
  if (loanQuery?._id) event.loanQuery = loanQuery._id;
  await event.save();
  return event;
};

export const creditReferralRewardOnDisbursal = async (
  userId: string,
  loanQuery: any,
) => {
  let event: any = await findReferralEvent(userId);
  if (!event) return null;
  const wasAlreadyRewarded = event.status === "rewarded";

  if (!wasAlreadyRewarded) {
    const program = await getReferralProgramConfig();
    if (!program?.isActive || !loanQuery?._id) return null;
    const disbursedAmount = getEligibleReferralDisbursedAmount(
      loanQuery,
      program.minimumDisbursementAmount,
    );
    if (disbursedAmount === null) return null;

    const rewardAmount = Number(program.rewardAmount);
    if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) return null;
    const points = Math.round(rewardAmount * POINTS_TO_RUPEE);
    const now = new Date();

    event = await ReferralEvent.findOneAndUpdate(
      {
        _id: event._id,
        status: { $ne: "rewarded" },
      },
      {
        $set: {
          status: "rewarded",
          lifecycleStage: "approved",
          payoutStatus: "pending",
          rewardAmount,
          points,
          rewardCreditVersion: 2,
          disbursedAmount,
          loanQuery: loanQuery._id,
          appliedAt: event.appliedAt || now,
          approvedAt: event.approvedAt || now,
          disbursedAt: loanQuery.disbursedDate || now,
        },
      },
      { new: true },
    );
    if (!event) {
      event = await findReferralEvent(userId);
    }
  }
  if (!event || event.status !== "rewarded") return null;

  // Older rewarded rows predate the v2 idempotency protocol. Treat those rows
  // (and any row with an existing credit timestamp) as already credited, then
  // backfill the marker without risking a second point increment.
  if (
    wasAlreadyRewarded &&
    (event.rewardCreditedAt || event.rewardCreditVersion !== 2)
  ) {
    await User.updateOne(
      { _id: event.referrer },
      { $addToSet: { referralRewardCredits: event._id } },
    );
    return event;
  }

  const credit = await User.updateOne(
    {
      _id: event.referrer,
      referralRewardCredits: { $ne: event._id },
    },
    {
      $inc: { referralPoints: event.points },
      $addToSet: { referralRewardCredits: event._id },
    },
  );
  if (credit.modifiedCount === 0) {
    const alreadyCredited = await User.exists({
      _id: event.referrer,
      referralRewardCredits: event._id,
    });
    if (!alreadyCredited) {
      // Leave rewardCreditedAt unset. A later disbursal sync can safely retry
      // because the event marker prevents duplicate point increments.
      throw new Error("Referral reward recipient could not be credited");
    }
  }

  const creditedEvent = await ReferralEvent.findByIdAndUpdate(
    event._id,
    { $set: { rewardCreditedAt: event.rewardCreditedAt || new Date() } },
    { new: true },
  );
  if (creditedEvent) event = creditedEvent;

  if (credit.modifiedCount > 0) {
    await sendSingleNotification({
      type: "referral-rewarded",
      toUserId: event.referrer.toString(),
      toRole: UserType.USER,
      context: {
        amount: event.rewardAmount,
        points: event.points,
      },
    }).catch((error: any) =>
      console.log(
        `[Notification] Failed to send referral reward: ${error?.message || error}`,
      ),
    );
  }
  return event;
};

export const syncReferralFromLoanStage = async (query: any) => {
  const customerId = String(query?.customerId?._id || query?.customerId || "");
  if (!customerId) return;
  const status = String(query?.status || "");
  if (
    [
      ApplicationStatus.SANCTIONED,
      ApplicationStatus.LOGIN_APPROVED,
      ApplicationStatus.APPROVED,
      ApplicationStatus.APPROVED_WITH_CONDITIONS,
    ].includes(status as ApplicationStatus)
  ) {
    await trackReferralApproval(customerId, query);
  }
  if (
    [
      ApplicationStatus.DISBURSED,
      ApplicationStatus.DISBURSED_PARTIAL_FULL,
    ].includes(status as ApplicationStatus)
  ) {
    await creditReferralRewardOnDisbursal(customerId, query);
  }
};
