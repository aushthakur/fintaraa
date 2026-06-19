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
      _id: decoded._id || decoded.id,
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

export const optionalAuthenticateToken = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const accessToken = req.header("Authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(accessToken, config.jwt.secret) as any;
    (req as AuthenticatedRequest).user = {
      role: decoded.role,
      email: decoded.email,
      _id: decoded._id || decoded.id,
    };
  } catch (_err) {
    // Public endpoints should still work when an optional session is stale.
  }

  next();
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

const normalizePermissionText = (value?: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const hasModulePermission = (permissions: any[] = [], moduleName: string) => {
  const normalizedModule = normalizePermissionText(moduleName);
  if (!normalizedModule) return false;

  return permissions.some((permission) => {
    const permissionModule = normalizePermissionText(permission?.module);
    if (permissionModule !== normalizedModule) return false;
    const access = permission?.access || {};
    return Object.values(access).some(Boolean);
  });
};

const resolvePermissionScope = async (userId: string) => {
  const [admin, agent, lander, agency] = await Promise.all([
    Admin.findById(userId).populate("role").lean().catch(() => null),
    Agent.findById(userId).populate("role").lean().catch(() => null),
    Lander.findById(userId).populate("role").lean().catch(() => null),
    Agency.findById(userId).populate("role").lean().catch(() => null),
  ]);

  return admin || agent || lander || agency || null;
};

export const authorizePermission =
  (...moduleNames: string[]): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      res.status(401).json({
        success: false,
        status: 401,
        message: "Unauthorized. Please log in.",
      });
      return;
    }

    if (user.role === "admin") {
      return next();
    }

    if (moduleNames.length === 0) {
      return next();
    }

    const scope = await resolvePermissionScope(user._id);
    const permissions = (scope as any)?.role?.permissions || [];
    const allowed = moduleNames.some((moduleName) =>
      hasModulePermission(permissions, moduleName),
    );

    if (allowed) {
      return next();
    }

    res.status(403).json({
      success: false,
      status: 403,
      message: `Forbidden: You do not have permission to access ${moduleNames.join(", ")}.`,
      allowedModules: moduleNames,
    });
  };

const getUserByRole = async (role: Role, id: string) => {
  if (role === "agent") {
    const employee = await Admin.findById(id).populate("role");
    if (employee && (employee as any)?.role?.name === "agent") {
      const data: any = employee.toObject();
      return { ...data, role: "agent" };
    }

    // Backward compatibility for legacy agent tokens
    const legacyAgent = await Agent.findById(id).populate("role");
    if (legacyAgent) {
      const data: any = legacyAgent.toObject();
      return { ...data, role: "agent" };
    }
    return null;
  }

  if (role === "admin") {
    const admin = await Admin.findById(id).populate("role");
    if (!admin) return null;
    const data: any = admin.toObject();
    return { ...data, role: "admin" };
  }

  const modelMap: Partial<Record<Role, any>> = {
    guest: User,
    property: User,
    lander: Lander,
    agency: Agency,
    agency_member: Agency,
  };
  const Model = modelMap[role];
  const user = await Model?.findById(id);
  if (!user) return null;
  return { ...(user.toObject ? user.toObject() : user), role };
};
