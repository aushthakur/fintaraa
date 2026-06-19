import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BankProduct, BankProductStatus } from "../../modals/bankProduct.model";
import { User } from "../../modals/user.model";

const BankProductService = new CommonService(BankProduct);
const DEFAULT_RANK_SORT = "sortRank:asc,createdAt:desc";

const withRankSorting = (query: Record<string, any>) => {
  const hasSort =
    query?.sortKey !== undefined ||
    query?.sortDir !== undefined ||
    query?.multiSort !== undefined;
  if (hasSort) {
    return { query, applyRankSort: false };
  }
  return {
    query: { ...query, multiSort: DEFAULT_RANK_SORT },
    applyRankSort: true,
  };
};

const applyRankSortStage = (pipeline: any[]) => {
  const sortIndex = pipeline.findIndex((stage) => stage?.$sort);
  if (sortIndex === -1) return pipeline;
  const next = [...pipeline];
  next.splice(sortIndex, 0, {
    $addFields: {
      sortRank: { $ifNull: ["$rank", 9999] },
    },
  });
  return next;
};

const numericValue = (value: any, fallback = 0) => {
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getPathValue = (source: any, paths: string[]) => {
  for (const path of paths) {
    const value = path.split(".").reduce((acc, key) => acc?.[key], source);
    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }
  return undefined;
};

const buildEligibilityBreakdown = (product: any, user: any) => {
  const income = numericValue(
    getPathValue(user, [
      "monthlyIncome",
      "employmentDetails.monthlyIncome",
      "employmentDetails.salary",
      "kycProfile.employmentDetails.monthlyIncome",
      "kycProfile.employmentDetails.salary",
    ]),
  );
  const cibilScore = numericValue(
    getPathValue(user, ["cibilScore", "cibilReport.data.credit_score"]),
  );
  const minimumIncome = numericValue(product?.minimumIncome);
  const creditScoreRequirement = numericValue(
    product?.creditScoreRequirement,
    700,
  );
  const incomeEligible = minimumIncome ? income >= minimumIncome : true;
  const scoreEligible = creditScoreRequirement
    ? cibilScore >= creditScoreRequirement
    : true;
  const eligible = incomeEligible && scoreEligible;

  return {
    eligible,
    score: eligible ? 100 : incomeEligible || scoreEligible ? 65 : 35,
    checks: [
      {
        key: "income",
        label: "Minimum monthly income",
        required: minimumIncome,
        current: income,
        passed: incomeEligible,
      },
      {
        key: "cibil",
        label: "Credit score requirement",
        required: creditScoreRequirement,
        current: cibilScore,
        passed: scoreEligible,
      },
    ],
    message: eligible
      ? "You match the key eligibility criteria for this card."
      : "Some eligibility criteria need attention before applying.",
  };
};

export class BankProductController {
  static async createBankProduct(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BankProductService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create bank product"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllBankProducts(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const role = (req as any)?.user?.role;
      const baseQuery = {
        ...req.query,
        ...(role === "admin" ? {} : { status: BankProductStatus.ACTIVE }),
      };
      const { query, applyRankSort } = withRankSorting(baseQuery);
      const result = await BankProductService.getAll(query, undefined, {
        pipelineModifier: applyRankSort ? applyRankSortStage : undefined,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getBankProductById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BankProductService.getById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Bank product not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateBankProductById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BankProductService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update bank product"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteBankProductById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BankProductService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete bank product"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPublicBankProducts(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const baseQuery = {
        ...req.query,
        status: BankProductStatus.ACTIVE,
      };
      const { query, applyRankSort } = withRankSorting(baseQuery);
      const result = await BankProductService.getAll(query, undefined, {
        pipelineModifier: applyRankSort ? applyRankSortStage : undefined,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPublicBankProductById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await BankProductService.getById(req.params.id);
      if (!result || result.status !== BankProductStatus.ACTIVE)
        return res
          .status(404)
          .json(new ApiError(404, "Bank product not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPublicBankProductFilters(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const type = String(req.query?.type || "credit_card");
      const match = { type, status: BankProductStatus.ACTIVE };
      const [
        banks,
        cardTypes,
        rewardsTypes,
        networks,
        annualFeeBuckets,
        incomeBuckets,
      ] = await Promise.all([
        BankProduct.distinct("bankName", match),
        BankProduct.distinct("cardType", match),
        BankProduct.distinct("rewardsType", match),
        BankProduct.distinct("cardNetwork", match),
        BankProduct.distinct("annualFeeBucket", match),
        BankProduct.distinct("incomeRequirementBucket", match),
      ]);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            banks: banks.filter(Boolean).sort(),
            cardTypes: cardTypes.filter(Boolean).sort(),
            rewardsTypes: rewardsTypes.filter(Boolean).sort(),
            networks: networks.filter(Boolean).sort(),
            annualFeeBuckets: annualFeeBuckets.filter(Boolean).sort(),
            incomeBuckets: incomeBuckets.filter(Boolean).sort(),
          },
          "Filter data fetched successfully"
        )
      );
    } catch (err) {
      next(err);
    }
  }

  static async trackPublicBankProductClick(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const action = String(req.body?.action || "apply").toLowerCase();
      const field = action === "detail" ? "detailViewCount" : "applyClickCount";
      const result = await BankProduct.findByIdAndUpdate(
        req.params.id,
        { $inc: { [field]: 1 } },
        { new: true }
      ).lean();
      if (!result || result.status !== BankProductStatus.ACTIVE) {
        return res
          .status(404)
          .json(new ApiError(404, "Bank product not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, { ok: true }, "Click tracked"));
    } catch (err) {
      next(err);
    }
  }

  static async getCreditCardEligibility(
    req: Request | any,
    res: Response,
    next: NextFunction
  ) {
    try {
      const [product, user] = await Promise.all([
        BankProduct.findById(req.params.id).lean(),
        User.findById(req.user?._id)
          .select(
            "name mobile cibilScore cibilReport employmentDetails kycProfile personalDetails"
          )
          .lean(),
      ]);
      if (!product || product.status !== BankProductStatus.ACTIVE) {
        return res
          .status(404)
          .json(new ApiError(404, "Bank product not found"));
      }
      if (!user) return res.status(404).json(new ApiError(404, "User not found"));

      return res.status(200).json(
        new ApiResponse(
          200,
          buildEligibilityBreakdown(product, user),
          "Eligibility calculated successfully"
        )
      );
    } catch (err) {
      next(err);
    }
  }
}
