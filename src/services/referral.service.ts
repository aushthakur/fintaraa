import { ReferralEvent } from "../modals/referralEvent.model";
import { User } from "../modals/user.model";
import { sendSingleNotification } from "./notification.service";
import { UserType } from "../modals/notification.model";

export const rewardReferralIfEligible = async (userId: string) => {
  const user: any = await User.findById(userId).select("referredBy");
  if (!user?.referredBy) return;

  const referrerId = user.referredBy;
  const existing = await ReferralEvent.findOne({
    referrer: referrerId,
    referredUser: userId,
  });

  if (existing?.status === "rewarded") return;

  if (existing) {
    existing.status = "rewarded";
    await existing.save();
  } else {
    const referrer = await User.findById(referrerId).select("referralCode");
    await ReferralEvent.create({
      referrer: referrerId,
      referredUser: userId,
      referralCode: referrer?.referralCode || "",
      status: "rewarded",
      points: 100,
    });
  }

  await User.findByIdAndUpdate(referrerId, { $inc: { referralPoints: 100 } });
  try {
    await sendSingleNotification({
      type: "referral-rewarded",
      toUserId: referrerId.toString(),
      toRole: UserType.USER,
      fromUser: { _id: referrerId.toString(), role: UserType.USER },
      context: { points: 100 },
    });
  } catch (error: any) {
    console.log(
      `[Notification] Failed to send referral-rewarded: ${error?.message || error}`
    );
  }
};
