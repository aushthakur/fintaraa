import {
  LOW_PRIORITY_TAGS,
  HIGH_PRIORITY_TAGS,
  MEDIUM_PRIORITY_TAGS,
  CRITICAL_PRIORITY_TAGS,
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

const agentService = new CommonService(Agent);
const ticketService = new CommonService(Ticket);

const resolveRequesterModel = (role?: string) => {
  if (role === "agency" || role === "agency_member") return "Agency";
  return "User";
};

const resolveNotificationRole = (role?: string) => {
  if (role === "agency" || role === "agency_member") return UserType.AGENCY;
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
): Promise<{ assigned: boolean; ticket: any; agent: any }> => {
  ticket.assignee = agent._id;
  ticket.status =
    ticket.status === "open" || ticket.status === "re_assigned"
      ? "in_progress"
      : ticket.status;
  await ticket.save();

  await Agent.updateOne({ _id: agent._id }, { $inc: { activeTickets: 1 } });

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

  if (ticket.assignee) {
    return { assigned: false, ticket, reason: "already_assigned" };
  }

  if (agentId) {
    const agent = await Agent.findOne({
      _id: agentId,
      availability: true,
    });

    if (!agent) {
      throw new ApiError(404, "Agent not found or inactive");
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

    if (!title || !description) {
      return next(new ApiError(400, "Title and description are required"));
    }

    const tagList = ensureTagArray(tags);
    if (!tagList.length) {
      return next(new ApiError(400, "At least one valid tag is required"));
    }

    const requesterRole = resolveRequesterModel(role);
    const duplicate = await Ticket.findOne({
      requester: id,
      requesterRole,
      $or: [{ tags: { $all: tagList } }, { title }, { description }],
      status: { $nin: ["closed", "resolved"] },
    });

    if (duplicate) {
      return res
        .status(409)
        .json(
          new ApiError(
            409,
            "Ticket with same tags, title, or description already exists.",
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
      title,
      description,
      requester: id,
      requesterRole,
      status: "open",
      dueDate: dueDatePlus24,
      priority: await checkPriority(tags),
      relatedTickets: await checkRelatedTickets(tags),
    };

    const ticket = await Ticket.create(obj);
    const assignment = await assignTicketToAgent(
      (ticket as any)._id.toString(),
    );
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
    if (tagList.includes("callback_request")) {
      try {
        const admins = await Admin.find({ role: { $in: ["admin", "manager"] } })
          .select("_id")
          .lean();
        const adminIds = admins.map((admin) => admin._id.toString());
        const callbackContext = {
          ticketId: ticket._id.toString(),
          callbackTime: new Date().toLocaleString(),
        };
        if (assignment.assigned && (assignment as any).agent?._id) {
          await sendSingleNotification({
            type: "ticket-created",
            toUserId: (assignment as any).agent._id.toString(),
            toRole: UserType.AGENT,
            fromUser: { _id: id.toString(), role: resolveNotificationRole(role) },
            context: callbackContext,
            direction: "sender",
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
    if (lowPriority.length > 0) return "low";
    else if (highPriority.length > 0) return "high";
    else if (mediumPriority.length > 0) return "medium";
    else if (criticalPriority.length > 0) return "critical";
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
    const result = await Ticket.findById(req.params.id)
      .populate("requester", "fullName name email mobile")
      .populate("assignee", "name email mobile availability skills")
      .populate("listingId", "title name productType type")
      .populate("transactionId", "title name productType type")
      .populate("relatedTickets", "title status")
      .lean();
    const requesterId =
      (result as any)?.requester?._id?.toString?.() ||
      result?.requester?.toString?.();
    const assigneeId =
      (result as any)?.assignee?._id?.toString?.() ||
      result?.assignee?.toString?.();

    if (role === "agent") {
      if (assigneeId !== userId.toString()) {
        return res
          .status(403)
          .json(new ApiError(403, "Unauthorized to access this ticket"));
      }
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
    }
    if (!result)
      return res.status(404).json(new ApiError(404, "Ticket not found"));
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
        status: { $nin: ["closed", "resolved"] },
      },
      { $unset: { assignee: "" }, $set: { status: "re_assigned" } },
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
    const { assignee } = req.query;
    const query: any = { ...req.query };
    let roleMatchStage: any = null;

    if (role === "agent") {
      query.assignee = assignee || userId;
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
        $addFields: {
          requesterInfo: {
            $ifNull: [
              { $arrayElemAt: ["$requesterInfo", 0] },
              { $arrayElemAt: ["$requesterAgency", 0] },
            ],
          },
          assigneeInfo: { $arrayElemAt: ["$assigneeInfo", 0] },
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
          resolutionDate: 1,
          assigneeId: "$assigneeInfo._id",
          requesterId: "$requesterInfo._id",
          assigneeName: "$assigneeInfo.name",
          assigneeEmail: "$assigneeInfo.email",
          assigneeMobile: "$assigneeInfo.mobile",
          requesterEmail: "$requesterInfo.email",
          requesterNumber: "$requesterInfo.mobile",
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

    const result = await agentService.getAll(req.query);
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
    if (ticketDaTa && ticketDaTa?.assignee) {
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
        status: { $nin: ["closed", "resolved"] },
      },
      { $unset: { assignee: "" }, $set: { status: "re_assigned" } },
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
}: any): Promise<any> => {
  const interaction: any = {
    initiator,
    receiver,
    initiatorType,
    receiverType,
    action,
    timestamp: new Date(),
  };

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
    let { role, _id } = req.user;
    const { initiator, receiver, action, content, ticketId } = req.body;

    const ticket = await Ticket.findById(ticketId);
    if (!ticket)
      return res.status(404).json(new ApiError(404, "Ticket not found"));

    // Admin can always interact with tickets
    const isAdmin = role === "admin";

    // Only initiator or assignee can interact
    if (role === "agency") {
      const memberIds = await Agency.find({ parentAgency: _id }).distinct(
        "_id",
      );
      const allowed = [_id.toString(), ...memberIds.map(String)];
      if (
        !allowed.includes(ticket.requester?.toString()) &&
        ticket.assignee?.toString() !== _id.toString()
      ) {
        return res
          .status(403)
          .json(
            new ApiError(403, "You are not authorized to access this ticket"),
          );
      }
    } else if (
      !isAdmin &&
      ticket.requester?.toString() !== _id &&
      ticket.assignee?.toString() !== _id
    ) {
      return res
        .status(403)
        .json(
          new ApiError(403, "You are not authorized to access this ticket"),
        );
    }

    const isRequesterRole = ["user", "agency", "agency_member"].includes(role);
    if (isRequesterRole && initiator?.toString() !== _id.toString()) {
      return res
        .status(403)
        .json(new ApiError(403, "Invalid initiator for this token"));
    }
    if (
      !isRequesterRole &&
      !isAdmin &&
      initiator?.toString() !== _id.toString()
    ) {
      return res
        .status(403)
        .json(new ApiError(403, "Invalid initiator for this token"));
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
    const requesterId = isRequesterRole ? initiator : receiver;
    const requesterExist =
      requesterModel === "Agency"
        ? await Agency.findById({ _id: requesterId })
        : await User.findById({ _id: requesterId });
    if (!requesterExist)
      return res.status(404).json(new ApiError(404, "Requester not found"));

    let effectiveReceiver: any = receiver;

    // For admin, use the provided receiver (should be requester for admin-to-user messaging)
    // For non-admin users, use existing logic
    if (!isAdmin) {
      if (isRequesterRole) {
        if (!ticket.assignee) {
          const assignment = await assignTicketAutomatically(ticket);
          if (
            assignment.assigned &&
            "agent" in assignment &&
            assignment.agent?._id
          ) {
            effectiveReceiver = assignment.agent._id;
          }
        }
        if (!effectiveReceiver && ticket.assignee) {
          effectiveReceiver = ticket.assignee;
        }
      }
    } else {
      // Admin context: receiver should be the requester for admin-to-user messaging
      // If receiver not provided, default to requester
      if (!effectiveReceiver) {
        effectiveReceiver = ticket.requester;
      }
    }

    const agentIdToCheck = isRequesterRole ? effectiveReceiver : initiator;
    if (agentIdToCheck && !isAdmin) {
      const agentExist = await Agent.findById({ _id: agentIdToCheck });
      if (!agentExist)
        return res.status(404).json(new ApiError(404, "Agent not found"));
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

    // Determine initiator and receiver types
    let initiatorType: string;
    let receiverType: string;

    if (isAdmin) {
      initiatorType = "Admin";
      receiverType = requesterModel;
    } else if (isRequesterRole) {
      initiatorType = requesterModel;
      receiverType = "Agent";
    } else {
      initiatorType = "Agent";
      receiverType = requesterModel;
    }

    const normalizedAction =
      action === "status_update" ? "status_changed" : action;

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
    res.status(500).json(new ApiError(500, "Failed to add interaction", error));
  }
};

export const manualAssignTicketToAgent = async (
  req: Request | any,
  res: Response,
): Promise<any> => {
  try {
    const { ticketId, agentId } = req.body;

    const result = await assignTicketToAgent(ticketId, agentId);

    if (!result.assigned) {
      return res
        .status(409)
        .json(new ApiError(409, "Ticket could not be assigned"));
    }

    res
      .status(200)
      .json(
        new ApiResponse(200, result.ticket, "Successfully assigned to agent"),
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
    .populate("assignee", "name email mobile")
    .populate("listingId", "title name productType type")
    .populate("transactionId", "title name productType type")
    .populate("relatedTickets", "title status");

  if (!ticketData) throw new Error("Ticket Doesn not exist: ");

  ticketData = JSON.parse(JSON.stringify(ticketData));

  const interaction: any = [];
  if (ticketData?.interactions?.length > 0) {
    ticketData.interactions.forEach((action: any) => {
      const isRequester = ["user", "agency", "agency_member"].includes(role);
      const initiatorType = action?.initiatorType;
      const isSender =
        (isRequester &&
          (initiatorType === "User" || initiatorType === "Agency")) ||
        (!isRequester && initiatorType === "Agent");
      if (action?.action === "internal_note" && isRequester) return;
      interaction.push({ ...action, isSender });
    });
  }
  ticketData.requester.name = ticketData?.requester?.name;
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

    if (ticket.status === status)
      return res.status(200).json({ success: true, message: "Status Updated" });

    if (ticket.status === "closed")
      return res
        .status(200)
        .json({ success: true, message: "Ticket has been already closed" });

    if (!ticket?.assignee && role !== "admin")
      return res
        .status(404)
        .json(new ApiError(404, "Ticket is not yet assigned"));

    if (
      (status === "closed" || status === "resolved") &&
      !ticket.resolutionDate &&
      ticket.assignee
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
          status: { $nin: ["closed", "resolved"] },
        },
        { $unset: { assignee: "" }, $set: { status: "re_assigned" } },
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
