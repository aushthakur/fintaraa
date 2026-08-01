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
import { sendSingleNotification } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";
import { generateApplicationId } from "../../utils/applicationId";

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

  const toNumber = (value: any) => {
    if (value === null || value === undefined || value === "") return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };

  const normalizeToken = (value?: string) =>
    value
      ? value
          .toString()
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";

  const minIncome = toNumber(eligibility.minIncome);
  const maxIncome = toNumber(eligibility.maxIncome);
  const maxEmiPerIncome = toNumber(eligibility.maxEmiPerIncome);
  const minCreditScore = toNumber(eligibility.minCreditScore);
  const maxActiveObligations = toNumber(eligibility.maxActiveObligations);
  const minAge = toNumber(eligibility.minAge);
  const maxAge = toNumber(eligibility.maxAge);

  if (minIncome !== undefined && snapshot.monthlyIncome < minIncome)
    return false;
  if (maxIncome !== undefined && snapshot.monthlyIncome > maxIncome)
    return false;
  if (maxEmiPerIncome !== undefined) {
    if (snapshot.emiToIncomeRatio === null) return false;
    if (snapshot.emiToIncomeRatio > maxEmiPerIncome) return false;
  }
  if (minCreditScore !== undefined) {
    if (!snapshot.creditScore) return false;
    if (snapshot.creditScore < minCreditScore) return false;
  }
  if (
    maxActiveObligations !== undefined &&
    snapshot.activeObligations > maxActiveObligations
  )
    return false;
  if (eligibility.employmentTypes?.length) {
    if (!snapshot.employmentType) return false;
    const normalizedEmployment = normalizeToken(snapshot.employmentType);
    const matchesEmployment = eligibility.employmentTypes.some(
      (type) => normalizeToken(type) === normalizedEmployment
    );
    if (!matchesEmployment) {
      return false;
    }
  }
  if (minAge !== undefined) {
    if (snapshot.age === undefined) return false;
    if (snapshot.age < minAge) return false;
  }
  if (maxAge !== undefined) {
    if (snapshot.age === undefined) return false;
    if (snapshot.age > maxAge) return false;
  }
  if (eligibility.allowedStates?.length) {
    if (!snapshot.state) return false;
    const stateValue = normalizeToken(snapshot.state);
    const matchesState = eligibility.allowedStates.some(
      (state) => normalizeToken(state) === stateValue
    );
    if (!matchesState) return false;
  }
  if (eligibility.allowedCities?.length) {
    if (!snapshot.city) return false;
    const cityValue = normalizeToken(snapshot.city);
    const matchesCity = eligibility.allowedCities.some(
      (city) => normalizeToken(city) === cityValue
    );
    if (!matchesCity) return false;
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

const deriveOfferCategory = (payload: Partial<IOffer>) => {
  if (payload.productCategory) return payload.productCategory;
  if (payload.productType === "credit_card" || payload.productType === "card")
    return "card";
  if (payload.productType === "insurance") return "insurance";
  return "loan";
};

export class OfferController {
  static async getPublicOffers(req: Request, res: Response, next: NextFunction) {
    try {
      const query: Record<string, any> = { status: "active" };
      if (req.query?.productCategory) {
        query.productCategory = req.query.productCategory;
      }
      if (req.query?.productType) {
        query.productType = req.query.productType;
      }

      const offers = await Offer.find(query)
        .select("-applications -createdBy -updatedBy")
        .sort({ validTo: 1, updatedAt: -1 })
        .limit(Math.min(Number(req.query?.limit) || 50, 100))
        .lean();
      const activeOffers = offers.filter((offer: any) => isOfferActive(offer));

      return res
        .status(200)
        .json(new ApiResponse(200, activeOffers, "Offers fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any)?.user?._id;
      const payload = {
        ...req.body,
        productCategory: deriveOfferCategory(req.body),
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
        productCategory: deriveOfferCategory(req.body),
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

      const offers = await Offer.find({ status: "active" })
        .select("-applications -createdBy -updatedBy")
        .lean();
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

  static async getMyApplications(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = (req as any)?.user?._id;
      if (!userId)
        return res.status(401).json(new ApiError(401, "Unauthorized"));

      const productCategory = String(req.query?.productCategory || "")
        .trim()
        .toLowerCase();
      const categoryFilter = ["loan", "insurance", "card"].includes(
        productCategory,
      )
        ? { productCategory }
        : {};

      const offers = await Offer.find({
        ...categoryFilter,
        "applications.user": new Types.ObjectId(String(userId)),
      })
        .select(
          "title lenderName productType productCategory applications createdAt updatedAt",
        )
        .lean();

      const applications = offers
        .flatMap((offer: any) =>
          (offer.applications || [])
            .filter((application: any) =>
              application?.user
                ? String(application.user) === String(userId)
                : false,
            )
            .map((application: any) => ({
              _id: `${offer._id}:${application.applicationId || userId}`,
              offerId: offer._id,
              applicationId:
                application.applicationId || String(offer._id),
              title: offer.title,
              lenderName: offer.lenderName,
              productType: offer.productType,
              productCategory: offer.productCategory,
              status: application.status || "applied",
              appliedAt: application.appliedAt,
              metadata: application.metadata || {},
              createdAt: application.appliedAt || offer.createdAt,
              updatedAt: application.appliedAt || offer.updatedAt,
            })),
        )
        .sort(
          (a: any, b: any) =>
            new Date(b.appliedAt || 0).getTime() -
            new Date(a.appliedAt || 0).getTime(),
        );

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            applications,
            "Offer applications fetched successfully",
          ),
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
      const metadata =
        req.body?.metadata && typeof req.body.metadata === "object"
          ? req.body.metadata
          : {};
      const existingApplication =
        existingIndex !== undefined && existingIndex >= 0
          ? offer.applications?.[existingIndex]
          : undefined;
      const applicationKind =
        offer.productCategory === "card"
          ? "card"
          : offer.productCategory === "insurance"
            ? "insurance-offer"
            : "loan-offer";
      const applicationId =
        existingApplication?.applicationId ||
        (await generateApplicationId(applicationKind));
      const applicationPayload = {
        applicationId,
        user: new Types.ObjectId(userId),
        status: (req.body?.status as any) || "applied",
        appliedAt: new Date(),
        notes: req.body?.notes,
        metadata: {
          source:
            metadata.source ||
            req.body?.source ||
            req.get("x-source-platform") ||
            "unknown",
          platform:
            metadata.platform ||
            req.body?.platform ||
            req.body?.sourcePlatform ||
            req.get("x-client-platform") ||
            metadata.source ||
            "unknown",
          ...metadata,
        },
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
      try {
        await sendSingleNotification({
          type: "offer-applied",
          toUserId: userId.toString(),
          toRole: UserType.USER,
          fromUser: { _id: userId.toString(), role: UserType.USER },
          context: { offerTitle: offer.title || "offer" },
        });
      } catch (error: any) {
        console.log(
          `[Notification] Failed to send offer-applied: ${
            error?.message || error
          }`
        );
      }

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            {
              offerId: offer._id,
              applicationId,
              referenceId: applicationId,
              productCategory: offer.productCategory,
            },
            "Offer application recorded"
          )
        );
    } catch (err) {
      next(err);
    }
  }
}
