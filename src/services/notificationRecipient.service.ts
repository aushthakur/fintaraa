import Admin from "../modals/admin.model";
import Agent from "../modals/agent.model";
import { UserType } from "../modals/notification.model";

export const canonicalNotificationRole = async (
  userId: string,
  claimedRole?: unknown,
): Promise<UserType> => {
  const normalized = String(claimedRole || "").trim().toLowerCase();

  if (normalized === UserType.AGENCY_MEMBER) return UserType.AGENCY_MEMBER;
  if (normalized === UserType.AGENCY) return UserType.AGENCY;
  if (normalized === UserType.USER) return UserType.USER;

  const [adminRecord, agentRecord] = await Promise.all([
    Admin.exists({ _id: userId }),
    Agent.exists({ _id: userId }),
  ]);
  if (adminRecord) return UserType.ADMIN;
  if (agentRecord) return UserType.AGENT;

  return Object.values(UserType).includes(normalized as UserType)
    ? (normalized as UserType)
    : UserType.USER;
};

export const notificationRoleAliases = async (
  userId: string,
  claimedRole?: unknown,
) => {
  const normalized = String(claimedRole || "").trim().toLowerCase();
  const canonical = await canonicalNotificationRole(userId, claimedRole);
  const staffCompatibilityRoles = [UserType.ADMIN, UserType.AGENT].includes(
    canonical,
  )
    ? [UserType.ADMIN, UserType.AGENT]
    : [];
  return Array.from(
    new Set([canonical, ...staffCompatibilityRoles, normalized].filter(Boolean)),
  );
};
