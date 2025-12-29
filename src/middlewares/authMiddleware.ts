import Admin from "../modals/admin.model";
import { config } from "../config/config";
import { User } from "../modals/user.model";
import Lander from "../modals/lander.model";
import Agent from "../modals/agent.model";
import { Agency } from "../modals/agency.model";
import { generateAccessToken } from "../utils/token";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import { Request, Response, NextFunction, RequestHandler } from "express";

export type Role =
  | "admin"
  | "guest"
  | "property"
  | "lander"
  | "agent"
  | "agency"
  | "agency_member";

interface AuthenticatedRequest extends Request {
  user?: {
    role: Role;
    _id: string;
    email?: string;
  };
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const accessToken = req.header("Authorization")?.replace("Bearer ", "");
  const refreshToken = req.cookies?.refreshToken;

  if (!accessToken) {
    return res
      .status(401)
      .json({ status: false, message: "Access token missing." });
  }

  try {
    const decoded = jwt.verify(accessToken, config.jwt.secret) as any;
    (req as AuthenticatedRequest).user = {
      role: decoded.role,
      email: decoded.email,
      _id: decoded._id || decoded._id,
    };
    return next();
  } catch (err) {
    if (err instanceof TokenExpiredError && refreshToken) {
      try {
        const decodedRefresh = jwt.verify(
          refreshToken,
          config.jwt.refreshSecret
        ) as any;

        const user = await getUserByRole(
          decodedRefresh.role,
          decodedRefresh._id
        );

        if (!user || user.refreshToken !== refreshToken) {
          return res
            .status(403)
            .json({ status: false, message: "Invalid refresh token." });
        }

        const newAccessToken = generateAccessToken({
          email: user.email,
          _id: user._id as string,
          role: user.role as any,
        });

        // Set new token in header (or optionally set cookie)
        res.setHeader("Authorization", `Bearer ${newAccessToken}`);
        (req as AuthenticatedRequest).user = {
          _id: user._id,
          role: user.role,
          email: user.email,
        };

        return next();
      } catch (refreshErr) {
        return res.status(401).json({
          status: false,
          message: "Session expired. Please log in again.",
        });
      }
    }
    return res
      .status(401)
      .json({ status: false, message: "Invalid or expired access token." });
  }
};

export const authorize =
  (...allowedRoles: Role[]): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      console.warn("🔒 Access denied: No user found in request.");
      res.status(401).json({
        success: false,
        status: 401,
        message: "Unauthorized. Please log in.",
      });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      console.warn(
        `🚫 Access denied for user ${user._id} with role '${user.role}'`
      );
      res.status(403).json({
        success: false,
        status: 403,
        message: `Forbidden: Your role '${user.role}' does not have permission to access this resource.`,
        allowedRoles,
      });
      return;
    }

    return next();
  };

const getUserByRole = async (role: Role, id: string) => {
  const modelMap: Record<Role, any> = {
    admin: Admin,
    guest: User,
    property: User,
    lander: Lander,
    agent: Agent,
    agency: Agency,
    agency_member: Agency,
  };
  const Model = modelMap[role];
  return Model?.findById(id);
};
