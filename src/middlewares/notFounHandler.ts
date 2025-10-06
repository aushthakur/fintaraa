import { Request, Response, NextFunction } from "express";

export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.status(404).json({
    success: false,
    method: req.method,
    url: req.originalUrl,
    message: "Route Not Found",
    timestamp: new Date().toISOString(),
  });
};
