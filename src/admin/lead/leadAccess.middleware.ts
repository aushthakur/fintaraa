import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import Lead from "../../modals/lead.model";
import ApiError from "../../utils/ApiError";

export type LeadStaffRole = "admin" | "agent" | "lander";

const idString = (value: unknown) =>
  String((value as any)?._id || value || "").trim();

export const isLeadStaffRole = (role: unknown): role is LeadStaffRole =>
  ["admin", "agent", "lander"].includes(
    String(role || "").trim().toLowerCase(),
  );

export const canAccessLeadRecord = ({
  actorId,
  actorRole,
  assignedAgentId,
}: {
  actorId: unknown;
  actorRole: unknown;
  assignedAgentId: unknown;
}) => {
  const normalizedRole = String(actorRole || "").trim().toLowerCase();
  if (normalizedRole === "admin") return true;
  if (!isLeadStaffRole(normalizedRole)) return false;

  const normalizedActorId = idString(actorId);
  return Boolean(
    normalizedActorId && normalizedActorId === idString(assignedAgentId),
  );
};

export const buildLeadOwnershipMatch = (
  actorId: unknown,
  actorRole: unknown,
): Record<string, any> | null => {
  const normalizedRole = String(actorRole || "").trim().toLowerCase();
  if (normalizedRole === "admin") return {};
  const normalizedActorId = idString(actorId);
  if (
    !["agent", "lander"].includes(normalizedRole) ||
    !Types.ObjectId.isValid(normalizedActorId)
  ) {
    return null;
  }
  return {
    "assignment.current.agent": new Types.ObjectId(normalizedActorId),
  };
};

/**
 * Param guard for every staff CRM route containing `:id`.
 * Admins can access every lead; agents and landers can only access the lead
 * currently assigned to their authenticated identity.
 */
export const requireLeadRecordAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
  rawLeadId: string,
) => {
  try {
    const leadId = String(rawLeadId || "").trim();
    if (!Types.ObjectId.isValid(leadId)) {
      return res.status(400).json(new ApiError(400, "Invalid lead ID"));
    }

    const actorId = (req as any).user?._id;
    const actorRole = (req as any).user?.role;
    const ownershipMatch = buildLeadOwnershipMatch(actorId, actorRole);
    if (!ownershipMatch) {
      return res
        .status(403)
        .json(new ApiError(403, "Lead CRM access is restricted to staff"));
    }

    const accessible = await Lead.exists({ _id: leadId, ...ownershipMatch });
    if (accessible) return next();

    const exists = await Lead.exists({ _id: leadId });
    if (!exists) {
      return res.status(404).json(new ApiError(404, "Lead not found"));
    }
    return res
      .status(403)
      .json(new ApiError(403, "You can only access leads assigned to you"));
  } catch (error) {
    return next(error);
  }
};
