import { Request, Response, NextFunction } from "express";

import ApiResponse from "../../utils/ApiResponse";

export const getStatements = async (
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Placeholder until actual document storage is wired. Returns an empty list.
  return res
    .status(200)
    .json(new ApiResponse(200, [], "Statements fetched successfully"));
};
