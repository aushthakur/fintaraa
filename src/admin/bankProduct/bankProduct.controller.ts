import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BankProduct, BankProductStatus } from "../../modals/bankProduct.model";

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
}
