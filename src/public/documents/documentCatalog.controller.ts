import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import { DocumentCatalog } from "../../modals/documentCatalog.model";

const requiredKeys = new Set(["pan_card", "aadhaar_card"]);

export const getDocumentCatalog = async (
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const items = await DocumentCatalog.find({ isActive: true })
    .sort({ sortOrder: 1, label: 1 })
    .lean();

  const mapped = items.map((item) => ({
    id: item._id,
    key: item.key,
    label: item.label,
    required: requiredKeys.has(item.key) ? true : item.required,
    numberLabel: item.numberLabel,
    isActive: item.isActive,
    sortOrder: item.sortOrder,
  }));

  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Document catalog fetched"));
};
