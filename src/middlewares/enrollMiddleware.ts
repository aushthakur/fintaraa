import { BookingEnrollment } from "../modals/bookingenrollment.model";
import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Middleware: Checks both feature access & quota limits
 */
export const authorizeFeature: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> => {
    try {
        const user = (req as any).user;
        const { role } = user || {};

        if (role === "admin") return next();

        if (!user?._id) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized: User information missing in request.",
            });
        }

        const now = new Date();
        const enrollment = await BookingEnrollment.findOne({
            userId: user._id,
            status: "active",
            startDate: { $lte: now },
            endDate: { $gte: now },
        }).sort({ endDate: -1 });

        if (!enrollment) {
            return res.status(403).json({
                status: false,
                message:
                    "No active subscription found. Please purchase a plan to access this feature.",
            });
        }

        if (now > enrollment.endDate) {
            return res.status(403).json({
                status: false,
                message:
                    "Your subscription has expired. Please renew to continue using this feature.",
            });
        }

        const totalAllowedUnits =
            enrollment.totalUnits + (enrollment.additionalUnitsPurchased || 0);
        if (enrollment.usedUnits >= totalAllowedUnits) {
            return res.status(403).json({
                status: false,
                message:
                    "You have reached your usage limit for this plan. Please purchase additional units.",
            });
        }
        (req as any).activeEnrollment = enrollment;
        next();
    } catch (error) {
        console.error("Feature authorization error:", error);
        return res.status(500).json({
            status: false,
            message:
                "An error occurred while verifying access. Please try again later.",
        });
    }
};
