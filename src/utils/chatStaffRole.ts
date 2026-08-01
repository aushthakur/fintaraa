import { Types } from "mongoose";
import Admin from "../modals/admin.model";
import Agent from "../modals/agent.model";
import Lander from "../modals/lander.model";

export type ChatStaffRole = "admin" | "agent" | "lander";

/**
 * Admin employees use dynamic role names (for example support or manager) in
 * their JWT. Chat authorization is based on the authenticated collection,
 * while the normalized role keeps downstream message models stable.
 */
export const resolveChatStaffRole = async (
  userId: any,
  tokenRole?: string,
): Promise<ChatStaffRole | null> => {
  const normalizedRole = String(tokenRole || "").trim().toLowerCase();
  if (["admin", "agent", "lander"].includes(normalizedRole)) {
    return normalizedRole as ChatStaffRole;
  }
  if (!userId || !Types.ObjectId.isValid(String(userId))) return null;

  const [admin, agent, lander] = await Promise.all([
    Admin.exists({ _id: userId, status: true }),
    Agent.exists({ _id: userId }),
    Lander.exists({ _id: userId }),
  ]);
  if (admin) return "admin";
  if (agent) return "agent";
  if (lander) return "lander";
  return null;
};

export const resolveChatActorRole = async (
  userId: any,
  tokenRole?: string,
): Promise<string> => {
  const normalizedRole = String(tokenRole || "").trim().toLowerCase();
  if (["user", "agency", "agency_member"].includes(normalizedRole)) {
    return normalizedRole;
  }
  return (await resolveChatStaffRole(userId, normalizedRole)) || normalizedRole;
};
