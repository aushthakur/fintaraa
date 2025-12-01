import ApiError from "../utils/ApiError";
import { ClientSession, Types } from "mongoose";
import Agent, { IAgent } from "../modals/agent.model";
import Lead, {
  ILead,
  LeadStatus,
  LeadPriority,
  ILeadAssignment,
  LeadActivityType,
  LeadConnectorType,
  LeadFollowUpStatus,
  LeadEscalationLevel,
} from "../modals/lead.model";
import {
  User,
  Gender,
  UserStatus,
  LoanProductType,
} from "../modals/user.model";

type NormalizedLeadPayload = {
  email?: string;
  mobile: string;
  fullName: string;
  status: LeadStatus;
  loanAmount?: number;
  cibilScore?: number;
  intentScore: number;
  loanPurpose?: string;
  priority: LeadPriority;
  whatsappOptIn?: boolean;
  productType?: LoanProductType;
  tags: string[];
  location?: {
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  capturedFrom: ILead["capturedFrom"];
  utm?: ILead["utm"];
  metadata?: Record<string, any>;
};

export interface CaptureLeadOptions {
  source: LeadConnectorType | string;
  channel?: string;
  metadata?: Record<string, any>;
  actorId?: string;
  session?: ClientSession;
  externalId?: string;
}

interface AssignmentContext {
  actorId?: string;
  reason?: string;
  session?: ClientSession;
  mode?: "auto" | "manual" | "reassign";
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizePhone = (input?: string): string | undefined => {
  if (!input) return undefined;
  const digits = input.toString().replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11)
    return `+91${digits.substring(1)}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
};

const uniqueStrings = (items: (string | null | undefined)[]): string[] => {
  const set = new Set<string>();
  items
    .filter((value): value is string => Boolean(value && value.trim()))
    .forEach((value) => set.add(value.trim().toLowerCase()));
  return Array.from(set);
};

const parseLoanProduct = (value?: string): LoanProductType | undefined => {
  if (!value) return undefined;
  const normalized = value.toString().toLowerCase();
  return Object.values(LoanProductType).find((option) => option === normalized);
};

const parseNumber = (value?: any): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const toBoolean = (value: any): boolean | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  const normalized = value.toString().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return undefined;
};

class LeadAssignmentEngine {
  static async ensureAssignment(
    lead: ILead,
    context: AssignmentContext
  ): Promise<ILead> {
    if (lead.assignment?.current?.agent) return lead;
    const agent = await this.findBestAgent(lead);
    if (!agent) return lead;
    return this.applyAssignment(lead, agent, { ...context, mode: "auto" });
  }

  static async reassignLead(
    lead: ILead,
    agent: IAgent,
    context: AssignmentContext
  ): Promise<ILead> {
    return this.applyAssignment(lead, agent, {
      ...context,
      mode: context.mode || "reassign",
    });
  }

  static async adjustAgentLoad(
    agentId?: Types.ObjectId,
    delta = 0,
    session?: ClientSession
  ) {
    if (!agentId || !delta) return;
    const update: Record<string, any> = { $inc: { activeLeads: delta } };
    if (delta > 0) update.$set = { lastLeadAssignedAt: new Date() };
    await Agent.updateOne({ _id: agentId }, update, { session });
  }

  private static async applyAssignment(
    lead: ILead,
    agent: IAgent,
    context: AssignmentContext
  ): Promise<ILead> {
    if (!agent) return lead;
    const previousAgent = lead.assignment?.current?.agent;
    const agentId = agent._id as Types.ObjectId;

    const entry: ILeadAssignment = {
      agent: agentId,
      assignedAt: new Date(),
      assignedBy: context.actorId
        ? new Types.ObjectId(context.actorId)
        : undefined,
      mode: context.mode || "manual",
      reason: context.reason,
      geography: lead.location?.pincode,
      productCategory: lead.productType,
      workloadSnapshot: {
        capacity: agent.leadCapacity ?? 40,
        activeLeads: (agent.activeLeads ?? 0) + 1,
      },
      priorityScore: this.computePriorityScore(lead, agent),
    };

    lead.assignment = lead.assignment || { history: [] };
    lead.assignment.current = entry;
    lead.assignment.history = [...(lead.assignment.history || []), entry];

    await this.adjustAgentLoad(agentId, 1, context.session);
    if (previousAgent && previousAgent.toString() !== agentId.toString()) {
      await this.adjustAgentLoad(previousAgent, -1, context.session);
    }

    lead.activities = lead.activities || [];
    lead.activities.push({
      type: LeadActivityType.ASSIGNED,
      description: `Lead assigned to ${agent.name}`,
      actor: context.actorId ? new Types.ObjectId(context.actorId) : undefined,
      actorModel: context.actorId ? "Admin" : undefined,
      payload: {
        agent: agentId,
        mode: entry.mode,
        reason: entry.reason,
      },
      createdAt: new Date(),
    });

    return lead;
  }

  private static computePriorityScore(lead: ILead, agent: IAgent): number {
    const capacity = agent.leadCapacity || 40;
    const activeLeads = agent.activeLeads || 0;
    const loadScore = capacity ? activeLeads / capacity : 0;
    const geoPenalty = this.scoreBoolean(
      this.isValueInArray(lead.location?.pincode, agent.serviceablePincodes)
    );
    const productPenalty = this.scoreBoolean(
      this.isValueInArray(lead.productType, agent.productFocus)
    );
    const priorityBoost =
      lead.priority === LeadPriority.VIP
        ? -0.5
        : lead.priority === LeadPriority.HOT
        ? -0.3
        : lead.priority === LeadPriority.WARM
        ? -0.1
        : 0;

    return Number(
      (loadScore || 0) +
        geoPenalty +
        productPenalty +
        priorityBoost +
        (agent.lastLeadAssignedAt
          ? agent.lastLeadAssignedAt.getTime() / 1_000_000_000_000
          : 0)
    );
  }

  private static scoreBoolean(match: boolean): number {
    return match ? 0 : 0.35;
  }

  private static isValueInArray(
    value?: string | LoanProductType,
    list?: string[] | LoanProductType[]
  ) {
    if (!value || !list || list.length === 0) return true;
    return list.map((item) => item?.toString()).includes(value.toString());
  }

  private static async findBestAgent(lead: ILead): Promise<IAgent | null> {
    const agents = await Agent.find({
      availability: true,
      leadAutoAssign: { $ne: false },
    });

    const scored = agents
      .map((agent) => ({
        agent,
        score: this.computePriorityScore(lead, agent),
      }))
      .sort((a, b) => a.score - b.score);

    return scored[0]?.agent || null;
  }
}

export class LeadManagementService {
  async captureLead(payload: Record<string, any>, options: CaptureLeadOptions) {
    const normalized = this.normalizePayload(payload, options);
    const existing = await this.findExistingLead(normalized);

    let lead =
      existing || new Lead({ ...normalized, notes: [], activities: [] });
    const now = new Date();

    if (existing) {
      this.mergeLead(existing, normalized);
      lead.activities.push({
        type: LeadActivityType.UPDATED,
        description: `Lead updated from ${normalized.capturedFrom.platform}`,
        payload: { channel: normalized.capturedFrom.channel },
        createdAt: now,
      });
    } else {
      lead.activities.push({
        type: LeadActivityType.CREATED,
        description: `Lead captured from ${normalized.capturedFrom.platform}`,
        payload: { channel: normalized.capturedFrom.channel },
        createdAt: now,
      });
    }

    lead.integrationEvents = lead.integrationEvents || [];
    lead.integrationEvents.push({
      provider: normalized.capturedFrom.platform,
      status: existing ? "processed" : "received",
      externalId: options.externalId,
      payload,
      receivedAt: now,
      processedAt: now,
      message: existing ? "Lead merged with existing record" : "Lead created",
    });

    lead.tags = Array.from(new Set([...(lead.tags || []), ...normalized.tags]));
    lead.metadata = {
      ...(lead.metadata || {}),
      ...(normalized.metadata || {}),
    };
    lead.utm = { ...(lead.utm || {}), ...(normalized.utm || {}) };

    lead = await LeadAssignmentEngine.ensureAssignment(lead, {
      actorId: options.actorId,
      session: options.session,
      reason: existing ? "duplicate_update" : "new_lead",
    });

    await lead.save({ session: options.session });

    return {
      lead,
      created: !existing,
    };
  }

  async addNote(
    leadId: string,
    payload: {
      content: string;
      visibility?: "internal" | "agent" | "public";
      channel?: string;
      attachments?: string[];
    },
    actor: { id: string; model?: "Admin" | "Agent" | "User" },
    session?: ClientSession
  ) {
    const addedBy = new Types.ObjectId(actor.id);
    const note = {
      content: payload.content,
      visibility: payload.visibility || "internal",
      channel: payload.channel || "crm",
      attachments: payload.attachments || [],
      addedAt: new Date(),
      addedBy,
      addedByModel: actor.model || "Admin",
    };

    const activity = {
      type: LeadActivityType.NOTE_ADDED,
      description: payload.content.substring(0, 120),
      actor: addedBy,
      actorModel: actor.model || "Admin",
      payload: { visibility: note.visibility },
      createdAt: new Date(),
    };

    const lead = await Lead.findByIdAndUpdate(
      leadId,
      {
        $push: { notes: note, activities: activity },
      },
      { new: true, session }
    );

    if (!lead) throw new ApiError(404, "Lead not found");
    return lead;
  }

  async addFollowUp(
    leadId: string,
    payload: {
      dueAt: string | Date;
      channel?: string;
      reminderAt?: string | Date;
      notes?: string;
    },
    actorId: string,
    session?: ClientSession
  ) {
    const dueAt = new Date(payload.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw new ApiError(400, "Invalid follow-up due date");
    }

    const reminderAt = payload.reminderAt
      ? new Date(payload.reminderAt)
      : undefined;

    const followUp = {
      dueAt,
      channel: payload.channel || "call",
      reminderAt,
      status: LeadFollowUpStatus.PENDING,
      addedBy: new Types.ObjectId(actorId),
      addedByModel: "Admin" as const,
      notes: payload.notes,
    };

    const activity = {
      type: LeadActivityType.FOLLOW_UP_ADDED,
      description: `Follow-up scheduled on ${dueAt.toISOString()}`,
      actor: new Types.ObjectId(actorId),
      actorModel: "Admin" as const,
      payload: { channel: followUp.channel },
      createdAt: new Date(),
    };

    const lead = await Lead.findByIdAndUpdate(
      leadId,
      {
        $push: { followUps: followUp, activities: activity },
        $set: { nextActionAt: dueAt },
      },
      { new: true, session }
    );

    if (!lead) throw new ApiError(404, "Lead not found");
    return lead;
  }

  async updateFollowUpStatus(
    leadId: string,
    followUpId: string,
    status: LeadFollowUpStatus,
    actorId: string,
    session?: ClientSession,
    outcome?: string
  ) {
    const lead = await Lead.findOneAndUpdate(
      { _id: leadId, "followUps._id": followUpId },
      {
        $set: {
          "followUps.$.status": status,
          "followUps.$.completedAt": new Date(),
          "followUps.$.outcome": outcome,
        },
        $push: {
          activities: {
            type: LeadActivityType.FOLLOW_UP_COMPLETED,
            description: `Follow-up ${status}`,
            actor: new Types.ObjectId(actorId),
            actorModel: "Admin",
            payload: { followUpId, outcome },
            createdAt: new Date(),
          },
        },
      },
      { new: true, session }
    );

    if (!lead) throw new ApiError(404, "Lead or follow-up not found");
    return lead;
  }

  async reassignLead(
    leadId: string,
    agentId: string,
    context: AssignmentContext
  ) {
    const lead = await Lead.findById(leadId);
    if (!lead) throw new ApiError(404, "Lead not found");

    const agent = await Agent.findById(agentId);
    if (!agent || !agent.availability) {
      throw new ApiError(404, "Agent not available for assignment");
    }

    await LeadAssignmentEngine.reassignLead(lead, agent, context);
    await lead.save({ session: context.session });
    return lead;
  }

async updateStatus(
    leadId: string,
    status: LeadStatus,
    actorId: string,
    session?: ClientSession,
    payload?: { reason?: string }
  ) {
    const lead = await Lead.findById(leadId);
    if (!lead) throw new ApiError(404, "Lead not found");
    const previousStatus = lead.status;
    if (previousStatus === status) return lead;

    lead.status = status;
    if (status === LeadStatus.CONTACTED) {
      lead.lastContactedAt = new Date();
    }
    if (status === LeadStatus.CONVERTED) {
      await this.ensureBorrowerProfile(lead, { session });
      lead.nextActionAt = undefined;
      await LeadAssignmentEngine.adjustAgentLoad(
        lead.assignment?.current?.agent,
        -1,
        session
      );
    }
    if (status === LeadStatus.CLOSED) {
      await LeadAssignmentEngine.adjustAgentLoad(
        lead.assignment?.current?.agent,
        -1,
        session
      );
    }

    lead.activities.push({
      type:
        status === LeadStatus.CONVERTED
          ? LeadActivityType.CONVERTED
          : LeadActivityType.STATUS_CHANGED,
      description: `Status changed from ${previousStatus} to ${status}`,
      actor: new Types.ObjectId(actorId),
      actorModel: "Admin",
      payload: payload,
      createdAt: new Date(),
    });

    await lead.save({ session });
    return lead;
  }

  async escalateLead(
    leadId: string,
    payload: {
      level: LeadEscalationLevel;
      reason: string;
      ownerId?: string;
      slaBreachInHours?: number;
    },
    actorId: string,
    session?: ClientSession
  ) {
    const escalation = {
      level: payload.level,
      reason: payload.reason,
      owner: payload.ownerId ? new Types.ObjectId(payload.ownerId) : undefined,
      triggeredAt: new Date(),
      slaBreachInHours: payload.slaBreachInHours,
    };

    const lead = await Lead.findByIdAndUpdate(
      leadId,
      {
        $set: { escalation },
        $push: {
          activities: {
            type: LeadActivityType.ESCALATED,
            description: payload.reason,
            actor: new Types.ObjectId(actorId),
            actorModel: "Admin",
            payload: escalation,
            createdAt: new Date(),
          },
        },
      },
      { new: true, session }
    );

    if (!lead) throw new ApiError(404, "Lead not found");
    return lead;
  }

  async convertLead(leadId: string, actorId: string, session?: ClientSession) {
    const lead = await Lead.findById(leadId);
    if (!lead) throw new ApiError(404, "Lead not found");

    const borrower = await this.ensureBorrowerProfile(lead, { session });
    lead.status = LeadStatus.CONVERTED;
    lead.activities.push({
      type: LeadActivityType.CONVERTED,
      description: `Borrower profile linked (${borrower._id})`,
      actor: new Types.ObjectId(actorId),
      actorModel: "Admin",
      payload: { borrowerId: borrower._id },
      createdAt: new Date(),
    });

    await LeadAssignmentEngine.adjustAgentLoad(
      lead.assignment?.current?.agent,
      -1,
      session
    );

    await lead.save({ session });
    return { lead, borrower };
  }

  private normalizePayload(
    payload: Record<string, any>,
    options: CaptureLeadOptions
  ): NormalizedLeadPayload {
    const fullName =
      payload.fullName ||
      [payload.firstName, payload.lastName, payload.name]
        .filter(Boolean)
        .join(" ") ||
      "Unknown Lead";

    const mobile = normalizePhone(
      payload.mobile || payload.phone || payload.msisdn
    );
    if (!mobile) throw new ApiError(400, "Mobile number is required for lead");

    const email = (
      payload.email ||
      payload.customerEmail ||
      payload.userEmail ||
      ""
    )
      .toString()
      .toLowerCase()
      .trim();

    const productType =
      parseLoanProduct(payload.productType) ||
      parseLoanProduct(payload.loanType) ||
      parseLoanProduct(payload.cardType);

    const loanAmount =
      parseNumber(payload.loanAmount) ||
      parseNumber(payload.loan_amount) ||
      parseNumber(payload.desiredAmount);

    const intentScore = clamp(
      parseNumber(payload.intentScore || payload.leadScore || payload.score) ||
        55,
      0,
      100
    );

    const tags = uniqueStrings([
      ...(Array.isArray(payload.tags)
        ? payload.tags
        : payload.tags
        ? [payload.tags]
        : []),
      payload.priority,
      payload.campaignName,
      productType,
      options.source,
    ]);

    const location = {
      city: payload.city || payload.customerCity,
      state: payload.state || payload.customerState,
      country: payload.country || payload.customerCountry,
      pincode:
        payload.pincode || payload.postalCode || payload.zip || payload.zipcode,
    };

    const priority = this.calculatePriority(
      intentScore,
      loanAmount,
      payload.priority,
      tags,
      toBoolean(payload.isVip)
    );

    const utm = {
      source: payload.utm_source || payload.utmSource,
      medium: payload.utm_medium || payload.utmMedium,
      campaign: payload.utm_campaign || payload.utmCampaign,
      term: payload.utm_term || payload.utmTerm,
      content: payload.utm_content || payload.utmContent,
    };

    const capturedFrom = {
      platform:
        (options.source as LeadConnectorType) || LeadConnectorType.MANUAL,
      channel: options.channel || payload.channel || "api",
      campaignId: payload.campaign_id || payload.campaignId,
      adGroupId: payload.adgroup_id || payload.adGroupId,
      adId: payload.ad_id || payload.adId,
      affiliateId: payload.affiliate_id || payload.affiliateId,
      landingPage: payload.landing_page || payload.landingPage,
      medium: utm.medium,
    } as ILead["capturedFrom"];

    return {
      fullName,
      email: email || undefined,
      mobile,
      whatsappOptIn: toBoolean(payload.whatsappOptIn) ?? false,
      productType,
      loanAmount,
      loanPurpose: payload.loanPurpose || payload.loan_goal,
      cibilScore: parseNumber(payload.cibilScore || payload.creditScore),
      intentScore,
      priority,
      status: LeadStatus.NEW,
      tags,
      location,
      capturedFrom,
      utm,
      metadata: {
        rawPayload: payload,
        channel: capturedFrom.channel,
        campaignName: payload.campaignName,
        formId: payload.form_id || payload.formId,
        zapierHookId: payload.zapierHookId,
      },
    };
  }

  private calculatePriority(
    intentScore: number,
    loanAmount?: number,
    priorityLabel?: string,
    tags: string[] = [],
    isVip?: boolean
  ): LeadPriority {
    if (isVip || tags.includes("vip")) {
      return LeadPriority.VIP;
    }

    const normalizedPriority = priorityLabel?.toString().toLowerCase();
    if (
      normalizedPriority &&
      Object.values(LeadPriority).includes(normalizedPriority as LeadPriority)
    ) {
      return normalizedPriority as LeadPriority;
    }

    if ((loanAmount || 0) >= 1_000_000 || intentScore >= 80) {
      return LeadPriority.HOT;
    }
    if (intentScore >= 55) {
      return LeadPriority.WARM;
    }
    return LeadPriority.COLD;
  }

  private async findExistingLead(data: NormalizedLeadPayload) {
    const filters = [] as Record<string, any>[];
    if (data.mobile) filters.push({ mobile: data.mobile });
    if (data.email) filters.push({ email: data.email });
    if (!filters.length) return null;
    return Lead.findOne({ $or: filters }).sort({ createdAt: -1 });
  }

  private mergeLead(target: ILead, source: NormalizedLeadPayload) {
    target.fullName = target.fullName || source.fullName;
    if (source.email && !target.email) target.email = source.email;
    target.priority =
      source.priority === LeadPriority.VIP ||
      target.priority === LeadPriority.COLD
        ? source.priority
        : target.priority;
    if (source.loanAmount) target.loanAmount = source.loanAmount;
    if (source.loanPurpose) target.loanPurpose = source.loanPurpose;
    if (source.cibilScore) target.cibilScore = source.cibilScore;
    target.intentScore = Math.max(target.intentScore ?? 0, source.intentScore);
    target.location = {
      ...(target.location || {}),
      ...(source.location || {}),
    };
    target.capturedFrom = {
      ...(target.capturedFrom || {}),
      ...source.capturedFrom,
    };
  }

  private async ensureBorrowerProfile(
    lead: ILead,
    options: { session?: ClientSession }
  ) {
    if (lead.borrowerProfile) {
      const borrower = await User.findById(lead.borrowerProfile);
      if (borrower) return borrower;
    }

    const lookup = [] as Record<string, any>[];
    if (lead.email) lookup.push({ email: lead.email });
    if (lead.mobile) lookup.push({ mobile: lead.mobile });

    let borrower = lookup.length ? await User.findOne({ $or: lookup }) : null;

    const email = lead.email || `${lead.mobile}@lead.auto`;

    if (!borrower) {
      borrower = new User({
        name: lead.fullName,
        email,
        mobile: lead.mobile,
        role: "user",
        agreedToTerms: true,
        privacyPolicyAccepted: true,
        gender: Gender.PREFER_NOT_TO_SAY,
        status: UserStatus.PENDING_VERIFICATION,
      } as any);
    } else {
      borrower.name = borrower.name || lead.fullName;
      borrower.email = borrower.email || email;
    }

    await borrower.save({ session: options.session });
    lead.borrowerProfile = borrower._id as Types.ObjectId;
    return borrower;
  }
}

export const leadManagementService = new LeadManagementService();
