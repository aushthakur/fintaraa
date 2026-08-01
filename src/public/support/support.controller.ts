import {
  BARTER_SPECIFIC_TAGS,
  CHAT_SOCIAL_TAGS,
  ESCALATED_TAGS,
  LOW_PRIORITY_TAGS,
  HIGH_PRIORITY_TAGS,
  MEDIUM_PRIORITY_TAGS,
  CRITICAL_PRIORITY_TAGS,
  SYSTEM_PRIORITY_TAGS,
} from "../../modals/ticket.model";
import ApiError from "../../utils/ApiError";
import Agent from "../../modals/agent.model";
import Admin from "../../modals/admin.model";
import { User } from "../../modals/user.model";
import Ticket from "../../modals/ticket.model";
import ApiResponse from "../../utils/ApiResponse";
import { Agency } from "../../modals/agency.model";
import { deleteFromS3 } from "../../config/s3Uploader";
import { LoanQuery } from "../../modals/loanquery.model";
import Role from "../../modals/role.model";
import { Request, Response, NextFunction } from "express";
import { UserType } from "../../modals/notification.model";
import { emitSupportMessage } from "../../config/socket.io";
import { CommonService } from "../../services/common.services";
import {
  DEFAULT_QUERY_TIMEZONE,
  buildDateRangeInTimeZone,
  convertToObjectId,
  extractImageUrl,
  formatDateInTimeZone,
} from "../../utils/helper";
import { sendSingleNotification } from "../../services/notification.service";
import { Types } from "mongoose";
import { CallRecord } from "../../modals/callRecord.model";
import { resolveChatStaffRole } from "../../utils/chatStaffRole";

const agentService = new CommonService(Agent);
const ticketService = new CommonService(Ticket);

const resolveRequesterModel = (role?: string) => {
  if (role === "agency" || role === "agency_member") return "Agency";
  return "User";
};

const resolveNotificationRole = (role?: string) => {
  if (role === "agency_member") return UserType.AGENCY_MEMBER;
  if (role === "agency") return UserType.AGENCY;
  return UserType.USER;
};

const ensureTagArray = (tags: unknown): string[] => {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => Boolean(tag));
  }
  if (typeof tags === "string" && tags.trim()) {
    return [tags.trim()];
  }
  return [];
};

const TICKET_TAG_ALIASES: Record<string, string> = {
  "application support": "app_support",
  application_support: "app_support",
  "document verification": "document_verification_support",
  document_verification: "document_verification_support",
  "payment or emi": "payment_emi_support",
  payment_emi: "payment_emi_support",
  "credit score": "credit_score_support",
  credit_score: "credit_score_support",
  insurance: "insurance_support",
  "account access": "account_access_support",
  account_access: "account_access_support",
  grievance: "grievance_support",
};

const VALID_TICKET_TAGS = new Set<string>([
  ...LOW_PRIORITY_TAGS,
  ...HIGH_PRIORITY_TAGS,
  ...MEDIUM_PRIORITY_TAGS,
  ...CRITICAL_PRIORITY_TAGS,
  ...SYSTEM_PRIORITY_TAGS,
  ...ESCALATED_TAGS,
  ...BARTER_SPECIFIC_TAGS,
  ...CHAT_SOCIAL_TAGS,
]);

const normalizeSubmittedTags = (tags: unknown): string[] => {
  const normalized = ensureTagArray(tags)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => TICKET_TAG_ALIASES[tag] || tag)
    .filter((tag) => VALID_TICKET_TAGS.has(tag));

  return Array.from(new Set(normalized));
};

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const parseBoolean = (value: unknown) =>
  value === true || value === "true" || value === "1" || value === 1;

const parseScheduledCallbackAt = (value: unknown) => {
  const callbackAt = new Date(String(value || ""));
  const minimum = Date.now() + 16 * 60 * 1000;
  const maximum = Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (
    Number.isNaN(callbackAt.getTime()) ||
    callbackAt.getTime() < minimum ||
    callbackAt.getTime() > maximum
  ) {
    throw new ApiError(
      400,
      "Choose a callback time between 16 minutes and 30 days from now",
    );
  }
  return callbackAt;
};

const normalizeObjectId = (value: any): Types.ObjectId | null => {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  const casted = String(value);
  if (!Types.ObjectId.isValid(casted)) return null;
  return new Types.ObjectId(casted);
};

const normalizeLabel = (value: unknown, fallback = "Loan") => {
  const source = String(value || fallback);
  return source
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (part) => part.toUpperCase());
};

const resolveSupportAssignee = async (assigneeId: any) => {
  const normalizedId = normalizeObjectId(assigneeId);
  if (!normalizedId) return null;

  const legacyAgent = await Agent.findById(normalizedId)
    .select("_id name email mobile availability skills")
    .lean();
  if (legacyAgent) return legacyAgent;

  const supportEmployee = await Admin.findById(normalizedId)
    .select("_id username name email mobile availability department role")
    .populate("role", "name")
    .lean();
  if (!supportEmployee) return null;

  return {
    ...supportEmployee,
    role:
      typeof supportEmployee.role === "object"
        ? (supportEmployee.role as any)?.name
        : supportEmployee.role,
  };
};

const findDefaultSupportAssignee = async () => {
  const supportRole = await Role.findOne({ name: "support" })
    .select("_id")
    .lean();
  if (supportRole?._id) {
    const supportEmployee = await Admin.findOne({
      role: supportRole._id,
      status: true,
      availability: true,
    })
      .sort({ updatedAt: -1, createdAt: 1 })
      .lean();
    if (supportEmployee?._id) {
      return { assignee: supportEmployee, model: "Admin" as const };
    }
  }

  const legacyAgent = await Agent.findOne({ availability: true })
    .sort({ activeTickets: 1, resolvedTickets: -1, createdAt: 1 })
    .lean();
  if (legacyAgent?._id) return { assignee: legacyAgent, model: "Agent" as const };

  return null;
};

const resolveAgencyScope = async (agencyId: any) => {
  const currentObjectId = normalizeObjectId(agencyId);
  if (!currentObjectId) {
    return { ownerObjectId: null, scopeObjectIds: [] as Types.ObjectId[] };
  }

  const currentAgency = await Agency.findById(currentObjectId)
    .select("_id parentAgency")
    .lean();
  const ownerObjectId =
    normalizeObjectId((currentAgency as any)?.parentAgency) || currentObjectId;
  const memberIds = await Agency.find({ parentAgency: ownerObjectId }).distinct(
    "_id",
  );

  const unique = new Map<string, Types.ObjectId>();
  [ownerObjectId, ...memberIds]
    .map((id) => normalizeObjectId(id))
    .filter((id): id is Types.ObjectId => Boolean(id))
    .forEach((id) => unique.set(id.toString(), id));

  return {
    ownerObjectId,
    scopeObjectIds: Array.from(unique.values()),
  };
};

const listAssignedAgentsForMatch = async (match: Record<string, any>) => {
  const loanQueries = await LoanQuery.find({
    ...match,
    assignedAgent: { $exists: true, $ne: null },
  })
    .select("_id loanType assignedAgent updatedAt createdAt")
    .populate("assignedAgent", "_id name username email mobile status")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const agentMap = new Map<string, any>();
  for (const query of loanQueries as any[]) {
    const populatedAgent = query?.assignedAgent;
    const assignedAgentId = normalizeObjectId(
      populatedAgent?._id || populatedAgent,
    );
    const channelId = normalizeObjectId(query?._id)?.toString();
    if (!assignedAgentId || !channelId) continue;

    const key = assignedAgentId.toString();
    if (agentMap.has(key)) continue;

    agentMap.set(key, {
      _id: key,
      id: key,
      name: populatedAgent?.name || populatedAgent?.username || "Assigned Agent",
      role: "Assigned Agent",
      serviceName: normalizeLabel(query?.loanType, "Loan"),
      phone: populatedAgent?.mobile,
      email: populatedAgent?.email,
      channelId,
      loanQueryId: channelId,
      status: populatedAgent?.status || "Assigned",
      isAssigned: true,
    });
  }

  return Array.from(agentMap.values());
};

const findEligibleAgentForTicket = async (tags: string[]) => {
  const skillQuery = tags.length ? { skills: { $in: tags } } : {};

  let agent = await Agent.findOne({
    availability: true,
    ...skillQuery,
  }).sort({ activeTickets: 1, resolvedTickets: -1, createdAt: 1 });

  if (!agent && tags.length) {
    agent = await Agent.findOne({ availability: true }).sort({
      activeTickets: 1,
      resolvedTickets: -1,
      createdAt: 1,
    });
  }

  return agent;
};

const assignTicketDocument = async (
  ticket: any,
  agent: any,
  assigneeModel: "Agent" | "Admin" = "Agent",
): Promise<{ assigned: boolean; ticket: any; agent: any }> => {
  const previousAssignee = ticket.assignee?.toString();
  const previousAssigneeModel = String(ticket.assigneeModel || "Agent");
  const nextAssignee = agent._id?.toString();

  ticket.assignee = agent._id;
  ticket.assigneeModel = assigneeModel;
  ticket.status =
    ticket.status === "open" || ticket.status === "re_assigned"
      ? "in_progress"
      : ticket.status;
  await ticket.save();

  if (previousAssignee !== nextAssignee) {
    if (previousAssignee && previousAssigneeModel === "Agent") {
      await Agent.updateOne(
        { _id: previousAssignee, activeTickets: { $gt: 0 } },
        { $inc: { activeTickets: -1 } },
      );
    }
    if (assigneeModel === "Agent") {
      await Agent.updateOne(
        { _id: agent._id },
        { $inc: { activeTickets: 1 } },
      );
    }
  }

  return { assigned: true, ticket, agent };
};

const assignTicketAutomatically = async (ticket: any) => {
  if (!ticket) throw new ApiError(404, "Ticket not found");
  if (ticket.assignee) {
    return { assigned: false, ticket, reason: "already_assigned" };
  }

  const tags = ensureTagArray(ticket.tags);
  const agent = await findEligibleAgentForTicket(tags);

  if (!agent) {
    const fallback = await findDefaultSupportAssignee();
    if (fallback?.assignee) {
      return assignTicketDocument(
        ticket,
        fallback.assignee,
        fallback.model,
      );
    }
    if (ticket.status !== "open") {
      ticket.status = "open";
      await ticket.save();
    }
    return { assigned: false, ticket, reason: "no_agent_available" };
  }

  return assignTicketDocument(ticket, agent);
};

const assignTicketToAgent = async (
  ticketId: string,
  agentId?: string,
): Promise<{
  assigned: boolean;
  ticket: any;
  agent?: any;
  reason?: string;
}> => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  if (agentId) {
    const supportRole = await Role.findOne({ name: "support" })
      .select("_id")
      .lean();
    const supportEmployee = supportRole?._id
      ? await Admin.findOne({
          _id: agentId,
          role: supportRole._id,
          status: true,
          availability: true,
        })
      : null;

    if (supportEmployee) {
      return assignTicketDocument(ticket, supportEmployee, "Admin");
    }

    const agent = await Agent.findOne({
      _id: agentId,
      availability: true,
      ...(supportRole?._id ? { role: supportRole._id } : {}),
    });

    if (!agent) {
      throw new ApiError(404, "Support agent not found or inactive");
    }

    const tags = ensureTagArray(ticket.tags);
    if (
      tags.length &&
      agent.skills &&
      agent.skills.length &&
      !agent.skills.some((skill: string) => tags.includes(skill))
    ) {
      throw new ApiError(
        400,
        "Selected agent does not have required skills for this ticket",
      );
    }

    return assignTicketDocument(ticket, agent);
  }

  return assignTicketAutomatically(ticket);
};

const autoAllocateQueuedTickets = async (): Promise<number> => {
  const queuedTickets = await Ticket.find({
    $or: [{ assignee: { $exists: false } }, { assignee: null }],
    status: { $in: ["open", "re_assigned"] },
  })
    .sort({ priority: 1, dueDate: 1, createdAt: 1 })
    .limit(50);

  let assignedCount = 0;
  for (const ticket of queuedTickets) {
    const result = await assignTicketAutomatically(ticket);
    if (result.assigned) assignedCount += 1;
  }

  return assignedCount;
};

export const createTicket = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { _id: id, role } = req.user;
    const { tags, title, description } = req.body;
    const cleanedTitle = cleanText(title);
    const cleanedDescription = cleanText(description);
    const communicationConsent =
      req.body?.communicationConsent &&
      typeof req.body.communicationConsent === "object"
        ? req.body.communicationConsent
        : {};

    if (!cleanedTitle || !cleanedDescription) {
      return next(new ApiError(400, "Title and description are required"));
    }

    const tagList = normalizeSubmittedTags(tags);
    if (!tagList.length) {
      return next(
        new ApiError(
          400,
          "Please select a valid support category and try again",
        ),
      );
    }

    const requesterRole = resolveRequesterModel(role);
    const isCallbackRequest = tagList.includes("callback_request");
    const callbackAt = isCallbackRequest
      ? parseScheduledCallbackAt(req.body?.callbackAt)
      : null;
    let requesterProfile: any = null;
    if (isCallbackRequest) {
      requesterProfile =
        requesterRole === "Agency"
          ? await Agency.findById(id).select("name email mobile").lean()
          : await User.findById(id).select("name email mobile").lean();
    }
    const callbackPhone = String((requesterProfile as any)?.mobile || "")
      .replace(/\D/g, "")
      .slice(-10);
    if (isCallbackRequest && callbackPhone.length !== 10) {
      return next(
        new ApiError(
          400,
          "A valid 10-digit mobile number is required for a callback request",
        ),
      );
    }
    const duplicate = await Ticket.findOne({
      requester: id,
      requesterRole,
      title: cleanedTitle,
      description: cleanedDescription,
      status: { $nin: ["closed", "resolved"] },
    }).collation({ locale: "en", strength: 2 });

    if (duplicate) {
      return res
        .status(409)
        .json(
          new ApiError(
            409,
            "This exact ticket is already open. Continue the conversation from your ticket history.",
          ),
        );
    }

    const todayKey = formatDateInTimeZone(
      new Date(),
      DEFAULT_QUERY_TIMEZONE,
    );
    const { start: todayStart, end: todayEnd } = buildDateRangeInTimeZone(
      todayKey,
      todayKey,
      1,
      DEFAULT_QUERY_TIMEZONE,
    );

    const result = await Ticket.aggregate([
      {
        $match: {
          requester: id,
          requesterRole,
          createdAt: {
            $gte: todayStart,
            $lte: todayEnd,
          },
        },
      },
    ]);

    if (result.length >= 2)
      return res
        .status(429)
        .json(
          new ApiError(
            429,
            "Daily ticket limit reached. Please try again tomorrow.",
          ),
        );

    const parsedDueDate = new Date();
    const dueDatePlus24 = new Date(
      parsedDueDate.getTime() + 48 * 60 * 60 * 1000,
    );

    const obj = {
      tags: tagList,
      title: cleanedTitle,
      description: cleanedDescription,
      requester: id,
      requesterRole,
      status: "open",
      dueDate: dueDatePlus24,
      priority: await checkPriority(tagList),
      relatedTickets: await checkRelatedTickets(tagList),
      source: cleanText(req.body?.source) || "website",
      platform:
        cleanText(req.body?.platform) ||
        cleanText(req.body?.sourcePlatform) ||
        "website",
      formSource: cleanText(req.body?.formSource) || "website_support_ticket",
      whatsappConsent:
        parseBoolean(req.body?.whatsappConsent) ||
        parseBoolean((communicationConsent as any)?.whatsapp),
      communicationConsent,
    };

    const ticket = await Ticket.create(obj);
    let callbackRecord: any = null;
    if (isCallbackRequest && callbackAt) {
      const nameParts = String((requesterProfile as any)?.name || "Customer")
        .trim()
        .split(/\s+/);
      try {
        callbackRecord = await CallRecord.create({
          phoneNumber: callbackPhone,
          firstName: nameParts.shift() || "Customer",
          lastName: nameParts.join(" "),
          email: (requesterProfile as any)?.email || undefined,
          callStatus: "callback_requested",
          leadStatus: "callback_requested",
          contactActionStatus: "pending",
          followUp: true,
          callbackAt,
          productService: "Support callback",
          dataSource: obj.source,
          leadBy: role,
          comment: cleanedDescription,
          supportTicketId: ticket._id,
          ...(requesterRole === "Agency" ? { channelAgency: id } : {}),
          followUpHistory: [
            {
              openedAt: new Date(),
              openingRemark: `Callback requested from ${obj.source}`,
              callbackAt,
            },
          ],
        });
      } catch (callbackError) {
        await Ticket.findByIdAndDelete(ticket._id).catch(() => undefined);
        throw callbackError;
      }
    }
    let assignment: any = {
      assigned: false,
      ticket,
      reason: "assignment_pending",
    };
    try {
      assignment = await assignTicketToAgent(
        (ticket as any)._id.toString(),
      );
    } catch (assignmentError: any) {
      console.log(
        `[Support] Ticket ${ticket._id} created but assignment is pending: ${
          assignmentError?.message || assignmentError
        }`,
      );
    }
    if (callbackRecord && assignment.assigned && (assignment as any).agent?._id) {
      const assignedId = (assignment as any).agent._id;
      callbackRecord = await CallRecord.findByIdAndUpdate(
        callbackRecord._id,
        {
          $set: {
            assignee: assignedId,
            assignees: [assignedId],
            assignedAt: new Date(),
            assignmentMode: "auto",
            "followUpHistory.0.assignedTo": assignedId,
            "followUpHistory.0.assignedToName":
              (assignment as any).agent.name || "Assigned agent",
          },
        },
        { new: true },
      );
    }
    try {
      await sendSingleNotification({
        type: "ticket-created",
        toUserId: id.toString(),
        toRole: resolveNotificationRole(role),
        fromUser: { _id: id.toString(), role: resolveNotificationRole(role) },
        context: { ticketId: ticket._id.toString() },
      });
    } catch (error: any) {
      console.log(
        `[Notification] Failed to send ticket-created: ${
          error?.message || error
        }`,
      );
    }
    if (isCallbackRequest) {
      try {
        const admins = await Admin.aggregate([
          { $match: { status: true } },
          {
            $lookup: {
              from: "roles",
              localField: "role",
              foreignField: "_id",
              as: "roleData",
            },
          },
          { $unwind: { path: "$roleData", preserveNullAndEmptyArrays: true } },
          { $match: { "roleData.name": { $not: /^agent$|^lander$/i } } },
          { $project: { _id: 1 } },
        ]);
        const assignedCallbackId =
          assignment.assigned && (assignment as any).agent?._id
            ? (assignment as any).agent._id.toString()
            : "";
        const adminIds = admins
          .map((admin) => admin._id.toString())
          .filter((adminId) => adminId !== assignedCallbackId);
        const callbackContext = {
          ticketId: ticket._id.toString(),
          callbackTime: callbackAt?.toISOString() || "",
          callbackRecordId: callbackRecord?._id?.toString?.() || "",
        };
        if (assignedCallbackId) {
          await sendSingleNotification({
            type: "ticket-created",
            toUserId: assignedCallbackId,
            toRole: UserType.AGENT,
            fromUser: { _id: id.toString(), role: resolveNotificationRole(role) },
            context: callbackContext,
            direction: "sender",
            dedupeKey: `callback-ticket:${ticket._id}:assignee:${assignedCallbackId}`,
          });
        }
        await Promise.all(
          adminIds.map((adminId) =>
            sendSingleNotification({
              type: "ticket-created",
              toUserId: adminId,
              toRole: UserType.ADMIN,
              fromUser: { _id: id.toString(), role: resolveNotificationRole(role) },
              context: callbackContext,
              direction: "sender",
              dedupeKey: `callback-ticket:${ticket._id}:admin:${adminId}`,
            }).catch((error) => {
              console.log(
                `[Notification] Failed to send callback ticket to ${adminId}: ${
                  error?.message || error
                }`,
              );
            }),
          ),
        );
      } catch (error: any) {
        console.log(
          `[Notification] Failed to fan out callback ticket: ${
            error?.message || error
          }`,
        );
      }
    }

    return res.status(201).json({
      data: ticket,
      success: true,
      message: assignment.assigned
        ? "Ticket generated and assigned successfully"
        : "Ticket generated successfully. Our agents will pick it up shortly.",
    });
  } catch (error) {
    next(
      error instanceof ApiError
        ? error
        : new ApiError(500, "Failed to create ticket", error),
    );
  }
};

export const createAgent = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const profilePictureUrl = req?.body?.profilePictureUrl?.[0]?.url;
    const duplicate = await Agent.findOne({
      $or: [
        { name: req.body.name },
        { email: req.body.email },
        { mobile: req.body.mobile },
      ],
    });
    let { availability } = req.body;
    if (availability === "active" || availability === "inactive") {
      req.body.availability = availability === "active";
    }
    if (duplicate) {
      if (profilePictureUrl) {
        const s3Key = profilePictureUrl.split(".com/")[1];
        await deleteFromS3(s3Key);
      }
      return res
        .status(409)
        .json(
          new ApiError(
            409,
            "Agent with same name, email, or mobile already exists.",
          ),
        );
    }
    const result = await agentService.create({
      ...req.body,
      profilePictureUrl,
    });
    if (!result) {
      return res
        .status(400)
        .json(new ApiError(400, "Failed to create Agent profile"));
    }
    await autoAllocateQueuedTickets();

    return res
      .status(201)
      .json(new ApiResponse(201, result, "Agent created successfully"));
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json(new ApiError(400, "Failed to create ticket", error));
  }
};

const checkPriority = async (tags: any): Promise<any> => {
  const lowPriority = [];
  const highPriority = [];
  const mediumPriority = [];
  const criticalPriority = [];

  tags.forEach((tag: any) => {
    if (HIGH_PRIORITY_TAGS.includes(tag)) {
      highPriority.push(tag);
    } else if (MEDIUM_PRIORITY_TAGS.includes(tag)) {
      mediumPriority.push(tag);
    } else if (LOW_PRIORITY_TAGS.includes(tag)) {
      lowPriority.push(tag);
    } else if (CRITICAL_PRIORITY_TAGS.includes(tag)) {
      criticalPriority.push(tag);
    }
  });

  function decideOverallPriority() {
    if (criticalPriority.length > 0) return "critical";
    else if (highPriority.length > 0) return "high";
    else if (mediumPriority.length > 0) return "medium";
    else if (lowPriority.length > 0) return "low";
    return "low";
  }
  return decideOverallPriority();
};

const checkRelatedTickets = async (tags: any): Promise<any> => {
  const response = await Ticket.aggregate([
    { $match: { tags: { $in: tags } } },
    { $project: { _id: 1 } },
  ]);
  return response.map((ticket) => ticket._id);
};

export const getTicket = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { role, _id: userId } = req.user;
    const staffRole = await resolveChatStaffRole(userId, role);
    const result: any = await Ticket.findById(req.params.id)
      .populate("requester", "fullName name email mobile")
      .populate("listingId", "title name productType type")
      .populate("transactionId", "title name productType type")
      .populate("relatedTickets", "title status")
      .lean();
    if (!result) {
      return res.status(404).json(new ApiError(404, "Ticket not found"));
    }
    const requesterId =
      (result as any)?.requester?._id?.toString?.() ||
      result?.requester?.toString?.();
    const assigneeId =
      (result as any)?.assignee?._id?.toString?.() ||
      result?.assignee?.toString?.();
    if (result?.assignee) {
      result.assignee =
        (await resolveSupportAssignee(result.assignee)) || result.assignee;
    }

    if (staffRole === "agent") {
      if (assigneeId !== userId.toString()) {
        return res
          .status(403)
          .json(new ApiError(403, "Unauthorized to access this ticket"));
      }
    } else if (staffRole === "admin") {
      // Active Admin employees (including support/manager roles) have the
      // operational overview required to assign and reply to tickets.
    } else if (role === "agency") {
      const agencyId = convertToObjectId(userId) || userId;
      const memberIds = await Agency.find({ parentAgency: agencyId }).distinct(
        "_id",
      );
      const allowed = [agencyId.toString(), ...memberIds.map(String)];
      if (!allowed.includes(requesterId)) {
        return res
          .status(403)
          .json(new ApiError(403, "Unauthorized to access this ticket"));
      }
    } else if (role === "agency_member") {
      if (requesterId !== userId.toString()) {
        return res
          .status(403)
          .json(new ApiError(403, "Unauthorized to access this ticket"));
      }
    } else if (role === "user") {
      if (requesterId !== userId.toString()) {
        return res
          .status(403)
          .json(new ApiError(403, "Unauthorized to access this ticket"));
      }
    } else {
      return res
        .status(403)
        .json(new ApiError(403, "Unauthorized to access this ticket"));
    }
    const requesterViewing = ["user", "agency", "agency_member"].includes(
      role,
    );
    result.interactions = (Array.isArray(result.interactions)
      ? result.interactions
      : []
    )
      .filter(
        (interaction: any) =>
          !(requesterViewing && interaction?.action === "internal_note"),
      )
      .map((interaction: any) => ({
        ...interaction,
        isSender: requesterViewing
          ? ["User", "Agency"].includes(interaction?.initiatorType)
          : ["Agent", "Admin"].includes(interaction?.initiatorType),
      }));
    return res
      .status(200)
      .json(new ApiResponse(200, result, "Data fetched successfully"));
  } catch (error) {
    console.log(error);
    next(new ApiError(500, "Error fetching ticket", error));
  }
};

export const deactivateAgent = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { id } = req.params;
    const agent = await Agent.findById(id);

    if (!agent)
      return res.status(400).json(new ApiError(400, "Agent not found"));

    await Ticket.updateMany(
      {
        assignee: id,
        $or: [
          { assigneeModel: "Agent" },
          { assigneeModel: { $exists: false } },
        ],
        status: { $nin: ["closed", "resolved"] },
      },
      {
        $unset: { assignee: "", assigneeModel: "" },
        $set: { status: "re_assigned" },
      },
    );

    const toggledAvailability = !agent.availability;
    agent.availability = toggledAvailability;
    if (!toggledAvailability) {
      agent.activeTickets = 0;
    }
    await agent.save();

    if (toggledAvailability) {
      await autoAllocateQueuedTickets();
    }

    return res.status(200).json({
      success: true,
      message: `Agent ${
        toggledAvailability ? "activated" : "deactivated"
      } successfully`,
    });
  } catch (error) {
    next(new ApiError(500, "Error fetching ticket", error));
  }
};

export const getAgentByID = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { id } = req.params;
    const agent = await Agent.findById(id);

    if (!agent) return next(new ApiError(400, "Agent not found"));

    return res.status(200).json({
      data: agent,
      success: true,
      message: `Agent Fetched successfully`,
    });
  } catch (error) {
    next(new ApiError(500, "Error fetching ticket", error));
  }
};

export const getTickets = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { _id: userId, role } = req.user;
    const staffRole = await resolveChatStaffRole(userId, role);
    const query: any = { ...req.query };
    let roleMatchStage: any = null;

    if (staffRole === "agent") {
      query.assignee = userId;
    } else if (staffRole === "admin") {
      // Keep the requested operational filters for Admin employees.
    } else if (role === "user") {
      query.requester = userId;
      query.requesterRole = "User";
    } else if (role === "agency") {
      const agencyId = convertToObjectId(userId) || userId;
      const memberIds = await Agency.find({ parentAgency: agencyId }).distinct(
        "_id",
      );
      query.requester = { $in: [agencyId, ...memberIds] };
      roleMatchStage = {
        $match: {
          $or: [
            { requesterRole: "Agency" },
            { requesterRole: { $exists: false } },
            { requesterRole: null },
          ],
        },
      };
    } else if (role === "agency_member") {
      query.requester = userId;
      roleMatchStage = {
        $match: {
          $or: [
            { requesterRole: "Agency" },
            { requesterRole: { $exists: false } },
            { requesterRole: null },
          ],
        },
      };
    } else {
      return res
        .status(403)
        .json(new ApiError(403, "Unauthorized to access support tickets"));
    }
    const pipeline = [
      {
        $lookup: {
          from: "users",
          localField: "requester",
          foreignField: "_id",
          as: "requesterInfo",
        },
      },
      {
        $lookup: {
          from: "agencies",
          localField: "requester",
          foreignField: "_id",
          as: "requesterAgency",
        },
      },
      {
        $lookup: {
          from: "agents",
          localField: "assignee",
          foreignField: "_id",
          as: "assigneeInfo",
        },
      },
      {
        $lookup: {
          from: "admins",
          localField: "assignee",
          foreignField: "_id",
          as: "assigneeAdminInfo",
        },
      },
      {
        $addFields: {
          requesterInfo: {
            $ifNull: [
              { $arrayElemAt: ["$requesterInfo", 0] },
              { $arrayElemAt: ["$requesterAgency", 0] },
            ],
          },
          assigneeInfo: {
            $ifNull: [
              { $arrayElemAt: ["$assigneeInfo", 0] },
              { $arrayElemAt: ["$assigneeAdminInfo", 0] },
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          tags: 1,
          title: 1,
          status: 1,
          dueDate: 1,
          priority: 1,
          createdAt: 1,
          description: 1,
          source: 1,
          platform: 1,
          formSource: 1,
          whatsappConsent: 1,
          communicationConsent: 1,
          resolutionDate: 1,
          assigneeId: "$assigneeInfo._id",
          requesterId: "$requesterInfo._id",
          assigneeName: "$assigneeInfo.name",
          assigneeEmail: "$assigneeInfo.email",
          assigneeMobile: "$assigneeInfo.mobile",
          requesterName: {
            $trim: {
              input: {
                $ifNull: [
                  "$requesterInfo.fullName",
                  {
                    $ifNull: [
                      "$requesterInfo.name",
                      {
                        $concat: [
                          { $ifNull: ["$requesterInfo.firstName", ""] },
                          " ",
                          { $ifNull: ["$requesterInfo.lastName", ""] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          requesterEmail: "$requesterInfo.email",
          requesterNumber: {
            $ifNull: ["$requesterInfo.mobile", "$requesterInfo.phone"],
          },
          requesterLastName: "$requesterInfo.lastName",
          requesterFirstName: "$requesterInfo.firstName",
        },
      },
    ];
    const result = await ticketService.getAll(query, pipeline, {
      prependStages: roleMatchStage ? [roleMatchStage] : [],
    });
    return res
      .status(200)
      .json(new ApiResponse(200, result, "Data fetched successfully"));
  } catch (error) {
    console.log(error);
    next(new ApiError(500, "Error fetching tickets", error));
  }
};

export const getAgents = async (
  req: Request | any,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { _id: userId, role } = req.user || {};
    if (role === "user" && userId) {
      const userObjectId = normalizeObjectId(userId);
      if (!userObjectId) {
        return res
          .status(200)
          .json(new ApiResponse(200, [], "Data fetched successfully"));
      }

      const agents = await listAssignedAgentsForMatch({
        customerId: userObjectId,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, agents, "Data fetched successfully"));
    }

    if ((role === "agency" || role === "agency_member") && userId) {
      const { ownerObjectId, scopeObjectIds } = await resolveAgencyScope(userId);
      if (!ownerObjectId || !scopeObjectIds.length) {
        return res
          .status(200)
          .json(new ApiResponse(200, [], "Data fetched successfully"));
      }

      const ownershipFilter = {
        $or: [
          { ownerAgency: ownerObjectId },
          {
            $and: [
              {
                $or: [
                  { ownerAgency: { $exists: false } },
                  { ownerAgency: null },
                ],
              },
              { customerId: { $in: scopeObjectIds } },
            ],
          },
        ],
      };

      const agents = await listAssignedAgentsForMatch(ownershipFilter);
      return res
        .status(200)
        .json(new ApiResponse(200, agents, "Data fetched successfully"));
    }

    const staffRole = await resolveChatStaffRole(userId, role);
    if (staffRole !== "admin" && staffRole !== "agent") {
      return res
        .status(403)
        .json(new ApiError(403, "Unauthorized to list support staff"));
    }

    const { roleName, role: roleFilter, ...query } = req.query || {};
    const requestedRole = String(roleName || roleFilter || "")
      .trim()
      .toLowerCase();

    if (requestedRole === "support") {
      const supportRole = await Role.findOne({ name: "support" })
        .select("_id name")
        .lean();
      if (!supportRole?._id) {
        return res
          .status(200)
          .json(new ApiResponse(200, [], "Data fetched successfully"));
      }

      const availability =
        query.availability === undefined
          ? undefined
          : String(query.availability).toLowerCase() === "true";
      const status =
        query.status === undefined
          ? true
          : String(query.status).toLowerCase() === "true";
      const supportEmployees = await Admin.find({
        role: supportRole._id,
        status,
        ...(availability === undefined ? {} : { availability }),
      })
        .select(
          "_id username name email mobile department location availability status profilePictureUrl role createdAt updatedAt",
        )
        .sort({ name: 1, username: 1, createdAt: -1 })
        .lean();

      const result = supportEmployees.map((employee: any) => ({
        ...employee,
        id: employee._id,
        roleId: supportRole._id,
        role: supportRole.name,
      }));

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    }

    const roleLookupPipeline: any[] = [
      {
        $lookup: {
          from: "roles",
          localField: "role",
          foreignField: "_id",
          as: "roleInfo",
        },
      },
      { $unwind: { path: "$roleInfo", preserveNullAndEmptyArrays: true } },
      ...(requestedRole && !Types.ObjectId.isValid(requestedRole)
        ? [{ $match: { "roleInfo.name": requestedRole } }]
        : []),
      {
        $project: {
          _id: 1,
          agentId: 1,
          name: 1,
          email: 1,
          mobile: 1,
          skills: 1,
          department: 1,
          availability: 1,
          activeTickets: 1,
          resolvedTickets: 1,
          profilePictureUrl: 1,
          roleId: "$roleInfo._id",
          role: "$roleInfo.name",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ];
    const result = await agentService.getAll(
      {
        ...query,
        ...(requestedRole && Types.ObjectId.isValid(requestedRole)
          ? { role: requestedRole }
          : {}),
      },
      roleLookupPipeline,
    );
    return res
      .status(200)
      .json(new ApiResponse(200, result, "Data fetched successfully"));
  } catch (error) {
    console.log(error);
    next(new ApiError(500, "Error fetching tickets", error));
  }
};

export const deleteTicket = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  try {
    const { id } = req.params;
    const ticketDaTa = await Ticket.findById(id);
    if (!ticketDaTa)
      return res.status(400).json(new ApiError(400, "Ticket not found"));
    if (
      ticketDaTa?.assignee &&
      String(ticketDaTa.assigneeModel || "Agent") === "Agent"
    ) {
      const agentData = await Agent.findById({ _id: ticketDaTa?.assignee });
      if (agentData) {
        agentData.activeTickets = Math.max(
          0,
          (agentData.activeTickets || 0) - 1,
        );
        await agentData.save();
      }
    }
    await Ticket.findByIdAndDelete(id);
    await autoAllocateQueuedTickets();
    res
      .status(200)
      .json({ success: true, message: "Ticket deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json(new ApiError(500, "Failed to delete ticket", error));
  }
};

export const deleteAgent = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  try {
    const { id } = req.params;
    const agent = await Agent.findById(id);

    if (!agent)
      return res.status(400).json(new ApiError(400, "Agent not found"));

    await Ticket.updateMany(
      {
        assignee: id,
        $or: [
          { assigneeModel: "Agent" },
          { assigneeModel: { $exists: false } },
        ],
        status: { $nin: ["closed", "resolved"] },
      },
      {
        $unset: { assignee: "", assigneeModel: "" },
        $set: { status: "re_assigned" },
      },
    );

    await Agent.findByIdAndDelete(id);
    await autoAllocateQueuedTickets();
    res
      .status(200)
      .json({ success: true, message: "Agent deleted successfully!" });
  } catch (error) {
    return res
      .status(500)
      .json(new ApiError(500, "Failed to delete ticket", error));
  }
};

const createInteractionObject = ({
  initiator,
  receiver,
  initiatorType,
  receiverType,
  action,
  content,
  attachments,
}: any): any => {
  const interaction: any = {
    initiator,
    initiatorType,
    action,
    timestamp: new Date(),
  };
  if (receiver) interaction.receiver = receiver;
  if (receiverType) interaction.receiverType = receiverType;

  if (action === "commented" || action === "internal_note") {
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!content && !hasAttachments) {
      throw new ApiError(
        400,
        "Content or attachment is required for this interaction",
      );
    }
    if (content) {
      interaction.content = content;
    }
    if (hasAttachments) {
      interaction.attachments = attachments;
    }
  }
  return interaction;
};

const getFileType = (
  mimetype: string,
): "image" | "video" | "audio" | "document" | "other" => {
  if (!mimetype) return "other";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  if (
    mimetype.includes("pdf") ||
    mimetype.includes("document") ||
    mimetype.includes("text")
  ) {
    return "document";
  }
  return "other";
};

export const addInteraction = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  try {
    const { role, _id } = req.user;
    const { action, ticketId } = req.body;
    const initiator = _id;
    const content = cleanText(req.body?.content);
    const actorId = _id?.toString?.() || String(_id);

    const ticket = await Ticket.findById(ticketId);
    if (!ticket)
      return res.status(404).json(new ApiError(404, "Ticket not found"));

    const staffRole = await resolveChatStaffRole(initiator, role);
    const isAdmin = staffRole === "admin";
    const isRequesterRole = ["user", "agency", "agency_member"].includes(role);

    if (role === "agency") {
      const memberIds = await Agency.find({ parentAgency: _id }).distinct(
        "_id",
      );
      const allowed = [_id.toString(), ...memberIds.map(String)];
      if (
        !allowed.includes(ticket.requester?.toString()) &&
        ticket.assignee?.toString() !== actorId
      ) {
        return res
          .status(403)
          .json(
            new ApiError(403, "You are not authorized to access this ticket"),
          );
      }
    } else if (
      !isAdmin &&
      ticket.requester?.toString() !== actorId &&
      ticket.assignee?.toString() !== actorId
    ) {
      return res
        .status(403)
        .json(
          new ApiError(403, "You are not authorized to access this ticket"),
        );
    }

    if (ticket.status === "closed")
      return res.status(400).json(new ApiError(400, "Ticket has been closed"));

    const requesterModel =
      ticket.requesterRole === "Agency"
        ? "Agency"
        : ticket.requesterRole === "User"
          ? "User"
          : (await Agency.exists({ _id: ticket.requester }))
            ? "Agency"
            : "User";
    const requesterId = ticket.requester;
    const requesterExist =
      requesterModel === "Agency"
        ? await Agency.findById({ _id: requesterId })
        : await User.findById({ _id: requesterId });
    if (!requesterExist)
      return res.status(404).json(new ApiError(404, "Requester not found"));

    let effectiveReceiver: any = isRequesterRole
      ? ticket.assignee
      : ticket.requester;

    if (isRequesterRole && !effectiveReceiver) {
      const assignment = await assignTicketAutomatically(ticket);
      if (
        assignment.assigned &&
        "agent" in assignment &&
        assignment.agent?._id
      ) {
        effectiveReceiver = assignment.agent._id;
      }
    }

    if (isRequesterRole && effectiveReceiver) {
      const agentExist = await Agent.findById({ _id: effectiveReceiver });
      const adminEmployeeExist = !agentExist
        ? await Admin.findById({ _id: effectiveReceiver }).select("_id").lean()
        : null;
      if (!agentExist && !adminEmployeeExist)
        return res
          .status(404)
          .json(new ApiError(404, "Support assignee not found"));
    }

    let attachments: any[] = [];
    if (req.body.media && Array.isArray(req.body.media)) {
      attachments = req.body.media.map((file: any) => ({
        url: file.url,
        type: getFileType(file.mimetype),
        name: file.name || file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      }));
    }

    let initiatorType: string;
    let receiverType: string | undefined;

    if (isAdmin) {
      initiatorType = "Admin";
      receiverType = requesterModel;
    } else if (isRequesterRole) {
      initiatorType = requesterModel;
      const receiverIsAdmin = effectiveReceiver
        ? await Admin.exists({ _id: effectiveReceiver })
        : null;
      receiverType = receiverIsAdmin ? "Admin" : "Agent";
    } else {
      initiatorType = (await Admin.exists({ _id: initiator }))
        ? "Admin"
        : "Agent";
      receiverType = requesterModel;
    }

    const requestedAction =
      action === "status_update" ? "status_changed" : action || "commented";
    const normalizedAction = isRequesterRole ? "commented" : requestedAction;
    if (
      !["commented", "status_changed", "resolved", "internal_note"].includes(
        normalizedAction,
      )
    ) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid ticket interaction action"));
    }

    const interaction = createInteractionObject({
      action: normalizedAction,
      content,
      receiver: effectiveReceiver,
      initiator,
      receiverType,
      initiatorType,
      attachments,
    });

    ticket.interactions.push(interaction);
    await ticket.save();

    const senderId = initiator?.toString?.() ?? initiator;
    const receiverId = effectiveReceiver?.toString?.() ?? effectiveReceiver;
    if ((content || attachments.length > 0) && senderId && receiverId) {
      emitSupportMessage({
        text: content,
        senderId,
        receiverId,
        ticketId: ticketId?.toString?.() ?? ticketId,
        attachments,
      });
    }

    res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    console.log(error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(error);
    }
    res.status(500).json(new ApiError(500, "Failed to add interaction", error));
  }
};

export const manualAssignTicketToAgent = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  try {
    const { ticketId, agentId } = req.body;
    const staffRole = await resolveChatStaffRole(
      req.user?._id,
      req.user?.role,
    );
    if (staffRole !== "admin") {
      throw new ApiError(
        403,
        "Only an active admin employee can assign support tickets",
      );
    }
    if (!Types.ObjectId.isValid(String(ticketId || ""))) {
      throw new ApiError(400, "A valid ticket is required");
    }
    if (agentId && !Types.ObjectId.isValid(String(agentId))) {
      throw new ApiError(400, "A valid support agent is required");
    }

    const result = await assignTicketToAgent(ticketId, agentId);

    if (!result.assigned) {
      return res
        .status(409)
        .json(new ApiError(409, "Ticket could not be assigned"));
    }

    const ticketPayload = result.ticket?.toObject?.() || result.ticket;
    if (ticketPayload?.assignee) {
      ticketPayload.assignee =
        (await resolveSupportAssignee(ticketPayload.assignee)) ||
        ticketPayload.assignee;
    }

    res.status(200).json(
      new ApiResponse(
        200,
        ticketPayload,
        "Successfully assigned to support agent",
      ),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(error);
    }
    console.log(error);
    res.status(500).json(new ApiError(500, "Failed to assign ticket", error));
  }
};

const getData = async (id: any, role: any): Promise<any> => {
  let ticketData: any = await Ticket.findById({ _id: id })
    .populate("requester", "fullName name email mobile")
    .populate("listingId", "title name productType type")
    .populate("transactionId", "title name productType type")
    .populate("relatedTickets", "title status");

  if (!ticketData) throw new Error("Ticket Doesn not exist: ");

  ticketData = JSON.parse(JSON.stringify(ticketData));
  if (ticketData?.assignee) {
    ticketData.assignee =
      (await resolveSupportAssignee(ticketData.assignee)) ||
      ticketData.assignee;
  }

  const interaction: any = [];
  if (ticketData?.interactions?.length > 0) {
    ticketData.interactions.forEach((action: any) => {
      const isRequester = ["user", "agency", "agency_member"].includes(role);
      const initiatorType = action?.initiatorType;
      const isSender =
        (isRequester &&
          (initiatorType === "User" || initiatorType === "Agency")) ||
        (!isRequester &&
          (initiatorType === "Agent" || initiatorType === "Admin"));
      if (action?.action === "internal_note" && isRequester) return;
      interaction.push({ ...action, isSender });
    });
  }
  if (ticketData?.requester && typeof ticketData.requester === "object") {
    ticketData.requester.name = ticketData.requester.name;
  }
  return { ...ticketData, interactions: interaction };
};

export const updateTicketStatus = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  const { role, _id } = req.user;
  const { status, id } = req.params;
  try {
    const ticket = await Ticket.findById({ _id: id });
    if (!ticket)
      return res.status(404).json(new ApiError(404, "Ticket not found"));
    const staffRole = await resolveChatStaffRole(_id, role);
    const isAdminEmployee = staffRole === "admin";
    const legacyAgent = staffRole === "agent"
      ? await Agent.exists({ _id, availability: true })
      : null;
    const isAssignedAgent = Boolean(
      staffRole === "agent" &&
        (legacyAgent || (await Admin.exists({ _id, status: true }))) &&
        ticket.assignee?.toString() === String(_id),
    );

    if (!isAdminEmployee && !isAssignedAgent) {
      return res
        .status(403)
        .json(new ApiError(403, "You are not authorized to update this ticket"));
    }

    if (ticket.status === status)
      return res.status(200).json({ success: true, message: "Status Updated" });

    if (ticket.status === "closed")
      return res
        .status(200)
        .json({ success: true, message: "Ticket has been already closed" });

    if (!ticket?.assignee && !isAdminEmployee)
      return res
        .status(404)
        .json(new ApiError(404, "Ticket is not yet assigned"));

    if (
      (status === "closed" || status === "resolved") &&
      !ticket.resolutionDate &&
      ticket.assignee &&
      String(ticket.assigneeModel || "Agent") === "Agent"
    ) {
      ticket.resolutionDate = new Date();
      const agentData: any = await Agent.findById({ _id: ticket.assignee });
      if (agentData) {
        agentData.activeTickets = Math.max(
          0,
          (agentData.activeTickets || 0) - 1,
        );
        agentData.resolvedTickets += 1;
        await agentData.save();
      }
    }

    const closingRemark = String(
      req.query?.closingRemark || req.body?.closingRemark || "",
    ).trim();
    if (closingRemark) {
      ticket.closingRemark = closingRemark;
    }
    if (status === "closed" || status === "resolved") {
      ticket.closedAt = new Date();
      ticket.closedBy = _id;
    }

    ticket.status = status;
    await ticket.save();

    const data = await getData(id, role);

    if (status === "closed" || status === "resolved") {
      await autoAllocateQueuedTickets();
    }
    try {
      await sendSingleNotification({
        type: "ticket-status-updated",
        toUserId: ticket.requester.toString(),
        toRole:
          ticket.requesterRole === "Agency" ? UserType.AGENCY : UserType.USER,
        fromUser: {
          _id: ticket.requester.toString(),
          role:
            ticket.requesterRole === "Agency" ? UserType.AGENCY : UserType.USER,
        },
        context: { ticketId: ticket._id.toString(), status },
      });
    } catch (error: any) {
      console.log(
        `[Notification] Failed to send ticket-status-updated: ${
          error?.message || error
        }`,
      );
    }

    return res.status(200).json({
      data: data,
      success: true,
      message: "updated",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json(new ApiError(500, "Failed to Assigned manually"));
  }
};

export const updateAgent = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  let { availability } = req.body;
  if (availability === "active" || availability === "inactive") {
    req.body.availability = availability === "active";
    availability = req.body.availability;
  }
  try {
    const userId = req.params.id;
    const profilePictureUrl = req?.body?.profilePictureUrl?.[0]?.url;
    const agent = await Agent.findById({ _id: userId });
    if (!agent) {
      if (profilePictureUrl) {
        const s3Key = profilePictureUrl.split(".com/")[1];
        await deleteFromS3(s3Key);
      }
      return res.status(404).json(new ApiError(404, "Agent not found"));
    }

    if (availability === false) {
      await Ticket.updateMany(
        {
          assignee: userId,
          $or: [
            { assigneeModel: "Agent" },
            { assigneeModel: { $exists: false } },
          ],
          status: { $nin: ["closed", "resolved"] },
        },
        {
          $unset: { assignee: "", assigneeModel: "" },
          $set: { status: "re_assigned" },
        },
      );
      agent.activeTickets = 0;
      req.body.activeTickets = 0;
    }
    let document;
    if (req?.body?.profilePictureUrl && agent.profilePictureUrl) {
      document = await extractImageUrl(
        req?.body?.profilePictureUrl,
        agent.profilePictureUrl as string,
      );
    }
    const updatePayload: any = {
      ...req.body,
      profilePictureUrl: document || profilePictureUrl,
    };

    if (typeof updatePayload.password === "string") {
      if (updatePayload.password.trim().length === 0) {
        delete updatePayload.password;
      } else {
        updatePayload.refreshToken = "";
      }
    }
    if (typeof updatePayload.password === "undefined") {
      delete updatePayload.password;
    }
    delete updatePayload["password-confirm"];

    const result = await agentService.updateById(userId, updatePayload);
    if (!result)
      return res.status(404).json(new ApiError(404, "Failed to update agent"));
    if (result.availability) {
      await autoAllocateQueuedTickets();
    }
    return res
      .status(200)
      .json(new ApiResponse(200, result, "Updated successfully"));
  } catch (error) {
    console.log(error);
    res.status(500).json(new ApiError(500, "Failed to Assigned manually"));
  }
};
