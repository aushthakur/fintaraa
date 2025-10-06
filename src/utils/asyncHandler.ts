import { Request, Response, NextFunction } from "express";

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.log("Async Error:", {
        stack: err.stack,
        method: req.method,
        message: err.message,
        route: req.originalUrl,
        timestamp: new Date().toISOString(),
      });
      next(err);
    });
  };
};
