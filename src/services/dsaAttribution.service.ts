import { Agency } from "../modals/agency.model";
import { UserStatus } from "../modals/user.model";
import ApiError from "../utils/ApiError";

const normalizeCode = (value: unknown) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);

export const resolveDsaAttribution = async (value: unknown) => {
  const code = normalizeCode(value);
  if (!code) return null;
  const agency = await Agency.findOne({
    $or: [{ referralCode: code }, { agencyId: code }],
    status: UserStatus.ACTIVE,
    "approvalReview.status": { $ne: "rejected" },
  })
    .select("_id parentAgency agencyId referralCode name")
    .lean();
  if (!agency) return null;

  return {
    channelAgency: agency._id,
    ownerAgency: agency.parentAgency || agency._id,
    attribution: {
      dsaReferralCode: agency.referralCode || agency.agencyId,
      dsaAgencyId: agency.agencyId,
      dsaChannelAgency: agency._id,
      dsaOwnerAgency: agency.parentAgency || agency._id,
      dsaAttributedAt: new Date(),
      dsaAttributionModel: "first_touch",
    },
  };
};

export const applyDsaAttribution = async (body: Record<string, any>) => {
  // Ownership is server-controlled. Non-agency application controllers call
  // this before persistence, so client-supplied ObjectIds must never win.
  delete body.channelAgency;
  delete body.ownerAgency;
  const submittedCode =
    body.dsaReferralCode || body.dsaCode || body.attribution?.dsaReferralCode;
  const attribution =
    body.attribution && typeof body.attribution === "object"
      ? { ...body.attribution }
      : {};
  for (const key of Object.keys(attribution)) {
    if (key.toLowerCase().startsWith("dsa")) delete attribution[key];
  }
  body.attribution = attribution;
  const resolved = await resolveDsaAttribution(submittedCode);
  if (!resolved) {
    if (normalizeCode(submittedCode)) {
      throw new ApiError(400, "Invalid or inactive DSA referral code");
    }
    return null;
  }
  body.channelAgency = resolved.channelAgency;
  body.ownerAgency = resolved.ownerAgency;
  body.attribution = {
    ...body.attribution,
    ...resolved.attribution,
  };
  delete body.dsaReferralCode;
  delete body.dsaCode;
  return resolved;
};
