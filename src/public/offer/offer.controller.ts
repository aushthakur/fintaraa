import { Types } from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Offer, IOffer } from "../../modals/offer.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import {
  User,
  IUser,
  EmploymentType,
  LoanProductType,
} from "../../modals/user.model";

const OfferService = new CommonService(Offer);

type UserSnapshot = {
  age?: number;
  city?: string;
  state?: string;
  totalEmi: number;
  creditScore?: number;
  monthlyIncome: number;
  activeObligations: number;
  employmentType?: EmploymentType;
  emiToIncomeRatio: number | null;
};

const calculateAge = (date?: Date | string | null) => {
  if (!date) return undefined;
  const dob = new Date(date);
  if (Number.isNaN(dob.getTime())) return undefined;
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
};

const getUserSnapshot = (user: IUser): UserSnapshot => {
  const kycFinancials = user?.kycProfile?.financialDetails;
  const kycEmployment = user?.kycProfile?.employmentDetails;
  const addresses = user?.addresses || [];
  const primaryAddress =
    (user as any)?.kycProfile?.addressDetails?.currentAddress || addresses?.[0];

  const pickNumber = (...values: any[]) => {
    for (const val of values) {
      if (val === null || val === undefined) continue;
      const num = Number(val);
      if (!Number.isNaN(num)) return num;
    }
    return undefined;
  };

  const monthlyIncome = pickNumber(
    kycFinancials?.monthlyIncome,
    kycEmployment?.monthlyIncome,
    (user as any)?.employmentDetails?.monthlyIncome,
    (user as any)?.profile?.monthlyIncome
  );

  const obligations = user?.loanCreditProfile?.existingObligations?.filter(
    (o) => o?.active !== false
  );
  const activeObligations =
    obligations && obligations.length > 0 ? obligations.length : null;
  const totalEmiFromLoans =
    obligations?.reduce((sum, item) => sum + (item?.emi || 0), 0) ?? null;
  const declaredEmi = kycFinancials?.existingEmiObligations;
  const totalEmi = pickNumber(declaredEmi, totalEmiFromLoans);

  const emiToIncomeRatio =
    monthlyIncome && totalEmi && monthlyIncome > 0
      ? Number((totalEmi / monthlyIncome).toFixed(2))
      : null;

  const age = calculateAge(
    user?.kycProfile?.personalDetails?.dateOfBirth as any
  );

  return {
    age,
    emiToIncomeRatio,
    totalEmi: totalEmi ?? 0,
    city: primaryAddress?.city,
    state: primaryAddress?.state,
    monthlyIncome: monthlyIncome ?? 0,
    activeObligations: activeObligations ?? 0,
    employmentType: kycEmployment?.employmentType,
    creditScore: user?.cibilScore ?? kycFinancials?.creditScore,
  };
};

const isOfferActive = (offer: IOffer) => {
  const now = new Date();
  if (offer.validFrom && offer.validFrom > now) return false;
  if (offer.validTo && offer.validTo < now) return false;
  return offer.status === "active";
};

const matchesEligibility = (offer: IOffer, user: IUser) => {
  const eligibility = offer?.eligibility || {};
  const snapshot = getUserSnapshot(user);

  if (eligibility.minIncome && snapshot.monthlyIncome < eligibility.minIncome)
    return false;
  if (eligibility.maxIncome && snapshot.monthlyIncome > eligibility.maxIncome)
    return false;
  if (eligibility.maxEmiPerIncome) {
    if (snapshot.emiToIncomeRatio === null) return false;
    if (snapshot.emiToIncomeRatio > eligibility.maxEmiPerIncome) return false;
  }
  if (
    eligibility.minCreditScore &&
    (!snapshot.creditScore || snapshot.creditScore < eligibility.minCreditScore)
  )
    return false;
  if (
    eligibility.maxActiveObligations &&
    snapshot.activeObligations > eligibility.maxActiveObligations
  )
    return false;
  if (eligibility.employmentTypes?.length) {
    if (!snapshot.employmentType) return false;
    if (!eligibility.employmentTypes.includes(snapshot.employmentType)) {
      return false;
    }
  }
  if (
    eligibility.minAge &&
    (snapshot.age === undefined || snapshot.age < eligibility.minAge)
  )
    return false;
  if (
    eligibility.maxAge &&
    (snapshot.age === undefined || snapshot.age > eligibility.maxAge)
  )
    return false;
  if (eligibility.allowedStates?.length) {
    if (!snapshot.state) return false;
    if (!eligibility.allowedStates.includes(snapshot.state)) return false;
  }
  if (eligibility.allowedCities?.length) {
    if (!snapshot.city) return false;
    if (!eligibility.allowedCities.includes(snapshot.city)) return false;
  }
  if (eligibility.allowedProductTypes?.length) {
    if (!offer.productType) return false;
    if (
      !eligibility.allowedProductTypes.includes(
        offer.productType as LoanProductType
      )
    )
      return false;
  }

  return true;
};

export class OfferController {
  static async createOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any)?.user?._id;
      const payload = {
        ...req.body,
        createdBy: adminId,
        updatedBy: adminId,
      };
      const result = await OfferService.create(payload);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Offer created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getOffers(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await OfferService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getOfferById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await OfferService.getById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any)?.user?._id;
      const result = await OfferService.updateById(req.params.id, {
        ...req.body,
        updatedBy: adminId,
      });
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update offer"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Offer updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await OfferService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete offer"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Offer deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getEligibleOffers(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = (req as any)?.user?._id;
      if (!userId)
        return res.status(401).json(new ApiError(401, "Unauthorized"));

      const user = await User.findById(userId).lean();
      if (!user)
        return res.status(404).json(new ApiError(404, "User not found"));

      const offers = await Offer.find({ status: "active" }).lean();
      const eligibleOffers = offers
        .filter((offer: any) => isOfferActive(offer))
        .filter((offer: any) => matchesEligibility(offer, user as any));

      const snapshot = getUserSnapshot(user as any);
      return res.status(200).json(
        new ApiResponse(200, {
          offers: eligibleOffers,
          snapshot,
        })
      );
    } catch (err) {
      next(err);
    }
  }

  static async applyForOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any)?.user?._id;
      if (!userId)
        return res.status(401).json(new ApiError(401, "Unauthorized"));

      const offer = await Offer.findById(req.params.id);
      if (!offer)
        return res.status(404).json(new ApiError(404, "Offer not found"));

      const existingIndex = offer.applications?.findIndex(
        (app) => app.user?.toString() === String(userId)
      );
      const applicationPayload = {
        user: new Types.ObjectId(userId),
        status: (req.body?.status as any) || "applied",
        appliedAt: new Date(),
        notes: req.body?.notes,
        metadata: req.body?.metadata,
      };

      if (existingIndex !== undefined && existingIndex >= 0) {
        offer.applications![existingIndex] = {
          ...offer.applications![existingIndex],
          ...applicationPayload,
        };
      } else {
        offer.applications = [
          ...(offer.applications || []),
          applicationPayload,
        ];
      }

      await offer.save();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { offerId: offer._id },
            "Offer application recorded"
          )
        );
    } catch (err) {
      next(err);
    }
  }
}
