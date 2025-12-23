import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BankProduct, BankProductStatus } from "../../modals/bankProduct.model";

const BankProductService = new CommonService(BankProduct);

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
      const result = await BankProductService.getAll({
        ...req.query,
        ...(role === "admin" ? {} : { status: BankProductStatus.ACTIVE }),
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
      const result = await BankProductService.getAll({
        ...req.query,
        status: BankProductStatus.ACTIVE,
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
