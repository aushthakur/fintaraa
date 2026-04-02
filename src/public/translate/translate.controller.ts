import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { translateTexts } from "../../services/googleTranslate.service";

const normalizeTextArray = (value: any) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
};

export const translateCopy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const texts = normalizeTextArray(req.body?.texts || req.body?.text);
    const targetLanguage = String(
      req.body?.targetLanguage ||
        req.body?.target ||
        req.body?.language ||
        "en",
    );
    const sourceLanguage = String(req.body?.sourceLanguage || req.body?.source || "auto");

    if (!targetLanguage.trim()) {
      throw new ApiError(400, "targetLanguage is required");
    }

    const result = await translateTexts({
      texts,
      targetLanguage,
      sourceLanguage,
    });

    return res.status(200).json(
      new ApiResponse(200, result, "Text translated successfully"),
    );
  } catch (error) {
    return next(error);
  }
};
