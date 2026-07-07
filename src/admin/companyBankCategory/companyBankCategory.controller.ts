import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import {
  CompanyBankCategory,
  CompanyCategoryStatus,
} from "../../modals/companyBankCategory.model";

const CompanyBankCategoryService = new CommonService(CompanyBankCategory);
const MASTER_TYPE = "company_bank_category";

const normalizeKey = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const slugifyKey = (value: string) => value.replace(/\s+/g, "-");

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeCategory = (value: any) => {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ");
  if (raw === "A" || raw === "CAT A" || raw === "CATA") return "CAT A";
  if (raw === "B" || raw === "CAT B" || raw === "CATB") return "CAT B";
  if (raw === "C" || raw === "CAT C" || raw === "CATC") return "CAT C";
  return "";
};

const normalizeCategories = (value: any) => {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(
    new Set(rawValues.map(normalizeCategory).filter(Boolean)),
  );
};

const normalizeAliases = (value: any) => {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(
    new Set(
      rawValues
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
};

const normalizeStatus = (value: any) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["inactive", "false", "0", "no"].includes(raw)) {
    return CompanyCategoryStatus.INACTIVE;
  }
  return CompanyCategoryStatus.ACTIVE;
};

const sanitizePayload = (payload: Record<string, any>) => {
  const companyName = String(payload.companyName || "").trim();
  const bankName = String(payload.bankName || "").trim();
  const categories = normalizeCategories(payload.categories);

  return {
    masterType: MASTER_TYPE,
    slug: `company-bank-category-${slugifyKey(normalizeKey(companyName))}-${slugifyKey(normalizeKey(bankName))}`,
    companyName,
    companyKey: normalizeKey(companyName),
    bankName,
    bankKey: normalizeKey(bankName),
    categories,
    aliases: normalizeAliases(payload.aliases),
    remarks: String(payload.remarks || "").trim(),
    status: normalizeStatus(payload.status),
  };
};

export class CompanyBankCategoryController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizePayload(req.body || {});
      if (!payload.companyName || !payload.bankName) {
        return res
          .status(400)
          .json(new ApiError(400, "Company name and bank name are required"));
      }
      if (payload.categories.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "At least one category is required"));
      }

      const result = await CompanyBankCategoryService.create(payload as any);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err: any) {
      if (err?.code === 11000) {
        return res
          .status(409)
          .json(new ApiError(409, "This company and bank mapping exists"));
      }
      next(err);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CompanyBankCategoryService.getAll({
        ...req.query,
        masterType: MASTER_TYPE,
      }, [
        { $sort: { companyName: 1, bankName: 1 } },
      ]);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q || req.query.companyName || "").trim();
      const bankName = String(req.query.bankName || req.query.bank || "").trim();
      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);

      const query: Record<string, any> = {
        masterType: MASTER_TYPE,
        status: CompanyCategoryStatus.ACTIVE,
      };

      if (q) {
        const regex = new RegExp(escapeRegExp(q), "i");
        query.$or = [
          { companyName: regex },
          { companyKey: regex },
          { aliases: regex },
        ];
      }
      if (bankName) query.bankName = new RegExp(escapeRegExp(bankName), "i");

      const results = await CompanyBankCategory.find(query)
        .select("companyName bankName categories aliases status")
        .sort({ companyName: 1, bankName: 1 })
        .limit(limit)
        .lean();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            q,
            bankName,
            total: results.length,
            results: results.map((item) => ({
              ...item,
              primaryCategory: item.categories?.[0] || "",
            })),
          },
          "Company category matches fetched successfully",
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CompanyBankCategoryService.getById(
        req.params.id,
        false,
      );
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Company category not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizePayload(req.body || {});
      if (!payload.companyName || !payload.bankName) {
        return res
          .status(400)
          .json(new ApiError(400, "Company name and bank name are required"));
      }
      if (payload.categories.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "At least one category is required"));
      }

      const result = await CompanyBankCategoryService.updateById(
        req.params.id,
        payload as any,
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err: any) {
      if (err?.code === 11000) {
        return res
          .status(409)
          .json(new ApiError(409, "This company and bank mapping exists"));
      }
      next(err);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CompanyBankCategoryService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete company category"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
