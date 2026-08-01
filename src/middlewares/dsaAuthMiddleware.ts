import { Request, Response, NextFunction } from "express";
import { Agency } from "../modals/agency.model";
import { UserStatus } from "../modals/user.model";

export const requireDsaRole = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const role = (req as any).user?.role;
  if (role !== "agency" && role !== "agency_member") {
    return res.status(403).json({
      statusCode: 403,
      success: false,
      message: "DSA account access required",
      data: null,
    });
  }
  return next();
};

export const requireApprovedDsa = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = (req as any).user;
    if (!user || !["agency", "agency_member"].includes(user.role)) {
      return requireDsaRole(req, res, next);
    }
    const agency = await Agency.findById(user._id)
      .select("_id parentAgency status approvalReview.status")
      .lean();
    if (!agency) {
      return res.status(404).json({
        statusCode: 404,
        success: false,
        message: "DSA account not found",
        data: null,
      });
    }
    const owner = agency.parentAgency
      ? await Agency.findById(agency.parentAgency)
          .select("_id status approvalReview.status")
          .lean()
      : agency;
    // Existing ACTIVE agencies pre-date approvalReview. New registrations stay
    // pending, so ACTIVE + not explicitly rejected is the compatibility bridge.
    const approved =
      agency.status === UserStatus.ACTIVE &&
      owner?.status === UserStatus.ACTIVE &&
      agency.approvalReview?.status !== "rejected" &&
      owner?.approvalReview?.status !== "rejected";
    if (!approved) {
      return res.status(403).json({
        statusCode: 403,
        success: false,
        message: "DSA account is awaiting admin approval",
        data: {
          status: agency.status,
          onboardingStatus: agency.approvalReview?.status || "pending",
        },
      });
    }
    (req as any).dsaAgency = agency;
    (req as any).dsaOwner = owner;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireApprovedDsaIfAgency = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const role = (req as any).user?.role;
  if (role === "agency" || role === "agency_member") {
    return requireApprovedDsa(req, res, next);
  }
  return next();
};
