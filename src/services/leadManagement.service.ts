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
import {
  LoanQuery,
  LoanType,
  LoanQueryActivityType,
} from "../modals/loanquery.model";
import {
  InsuranceQuery,
  InsuranceType,
  InsuranceQueryActivityType,
  ApplicationStatus,
} from "../modals/insurancequery.model";
import LanderAssignmentEngine from "./landerAssignment.service";
import { config } from "../config/config";
import {
  InteraktTemplatePayload,
  sendInteraktTemplateMessage,
} from "./interakt.service";

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

const splitInteraktPhone = (input: string, defaultCountryCode: string) => {
  const digits = input.replace(/\D/g, "");
  const countryDigits = defaultCountryCode.replace(/\D/g, "");
  if (
    digits.startsWith(countryDigits) &&
    digits.length > countryDigits.length
  ) {
    return {
      countryCode: `+${countryDigits}`,
      phoneNumber: digits.slice(countryDigits.length),
    };
  }
  return {
    countryCode: `+${countryDigits}`,
    phoneNumber: digits,
  };
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

    // If decrementing, ensure activeLeads doesn't go below 0
    if (delta < 0) {
      const agent = await Agent.findById(agentId).session(session || null);
      if (!agent) return;

      const newCount = Math.max(0, (agent.activeLeads || 0) + delta);
      await Agent.updateOne(
        { _id: agentId },
        { $set: { activeLeads: newCount } },
        { session }
      );
    } else {
      // For incrementing, use $inc and update lastLeadAssignedAt
      const update: Record<string, any> = { $inc: { activeLeads: delta } };
      update.$set = { lastLeadAssignedAt: new Date() };
      await Agent.updateOne({ _id: agentId }, update, { session });
    }
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

    let lead: any =
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
    if (!existing) await this.notifyInteraktLeadCreated(lead, options);
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

  async convertLead(
    leadId: string,
    actorId: string,
    queryData: any,
    session?: ClientSession
  ) {
    console.log(`\n🔍 Step 1: Finding lead with ID: ${leadId}`);
    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.error(`❌ Lead not found: ${leadId}`);
      throw new ApiError(404, "Lead not found");
    }
    console.log(`✅ Lead found: ${lead.fullName} (${lead.mobile})`);

    console.log(`\n🔍 Step 2: Ensuring borrower profile exists...`);
    const borrower = await this.ensureBorrowerProfile(lead, { session });
    console.log(`✅ Borrower profile ready: ${borrower._id}`);

    console.log(`\n🔍 Step 3: Updating lead status to CONVERTED...`);
    lead.status = LeadStatus.CONVERTED;

    // Clear escalation when converting (escalation is no longer relevant for converted leads)
    if (lead.escalation) {
      console.log(`🧹 Clearing escalation data...`);
      lead.escalation = undefined;
    }

    lead.activities.push({
      type: LeadActivityType.CONVERTED,
      description: `Borrower profile linked (${borrower._id})`,
      actor: new Types.ObjectId(actorId),
      actorModel: "Admin",
      payload: { borrowerId: borrower._id },
      createdAt: new Date(),
    });
    console.log(`✅ Lead status updated and activity logged`);

    console.log(`\n🔍 Step 4: Adjusting agent load...`);
    await LeadAssignmentEngine.adjustAgentLoad(
      lead.assignment?.current?.agent,
      -1,
      session
    );
    console.log(`✅ Agent load adjusted`);

    // Create query if data provided from admin form
    let createdQuery = null;
    if (queryData) {
      console.log(`\n🔍 Step 5: Creating query from admin form data...`);
      console.log(
        `📝 Query Type:`,
        queryData.loanType
          ? "Loan"
          : queryData.typeOfInsurance
          ? "Insurance"
          : "Unknown"
      );

      if (queryData.loanType) {
        console.log(`💰 Creating loan query...`);
        createdQuery = await this.createLoanQueryFromFormData(
          lead,
          borrower,
          actorId,
          queryData,
          session
        );
      } else if (queryData.typeOfInsurance) {
        console.log(`🏥 Creating insurance query...`);
        createdQuery = await this.createInsuranceQueryFromFormData(
          lead,
          borrower,
          actorId,
          queryData,
          session
        );
      } else {
        console.log(`⚠️ No valid query type in form data`);
      }
    } else {
      console.log(`\n⚠️ No query data provided - skipping query creation`);
    }

    console.log(`\n🔍 Step 6: Saving lead changes...`);
    await lead.save({ session });
    console.log(`✅ Lead saved successfully`);

    return { lead, borrower, query: createdQuery };
  }

  private async createLoanQueryFromFormData(
    lead: ILead,
    borrower: any,
    actorId: string,
    formData: any,
    session?: ClientSession
  ) {
    console.log(`  📝 Building loan query from form data...`);

    // Merge form data with lead/borrower data
    const loanQueryData: any = {
      ...formData,
      customerId: borrower._id,
      // Ensure bankStatementUrl has a value - use placeholder if not uploaded yet
      bankStatementUrl: formData.bankStatementUrl || "",
      status: ApplicationStatus.PENDING, // Set as PENDING - form has all required data
      activities: [
        {
          type: LoanQueryActivityType.CREATED,
          description: `Loan query created from converted lead ${lead._id}`,
          actor: new Types.ObjectId(actorId),
          actorModel: "Admin" as const,
          payload: { leadId: lead._id },
          createdAt: new Date(),
        },
      ],
    };

    console.log(`  🔨 Creating LoanQuery document...`);
    const loanQuery = new LoanQuery(loanQueryData);

    // Auto-assign lander if available
    console.log(`  🔍 Attempting to auto-assign lander...`);
    const assignedQuery = await LanderAssignmentEngine.ensureAssignment(
      loanQuery,
      {
        actorId: actorId,
        reason: "auto_created_from_lead",
        session,
      }
    );

    console.log(`  💾 Saving loan query...`);
    await assignedQuery.save({ session }); // Normal validation will run

    console.log(`  ✅✅ Loan query created: ${assignedQuery._id}`);
    console.log(`  📊 Loan Query Details:`, {
      queryId: assignedQuery._id,
      loanType: (assignedQuery as any).loanType,
      loanAmount: (assignedQuery as any).loanAmount,
      customerId: assignedQuery.customerId,
      assignedLander: assignedQuery.assignedLander,
      status: (assignedQuery as any).status,
    });

    return assignedQuery;
  }

  private async createInsuranceQueryFromFormData(
    lead: ILead,
    borrower: any,
    actorId: string,
    formData: any,
    session?: ClientSession
  ) {
    console.log(`  📝 Building insurance query from form data...`);

    // Merge form data with lead/borrower data
    const insuranceQueryData: any = {
      ...formData,
      customerId: borrower._id,
      // Ensure kycDocumentUrl has a value - use placeholder if not uploaded yet
      kycDocumentUrl:
        formData.kycDocumentUrl || formData.kycDocument || "pending_upload",
      status: ApplicationStatus.PENDING, // Set as PENDING - form has all required data
      activities: [
        {
          type: InsuranceQueryActivityType.CREATED,
          description: `Insurance query created from converted lead ${lead._id}`,
          actor: new Types.ObjectId(actorId),
          actorModel: "Admin" as const,
          payload: {
            leadId: lead._id,
            insuranceType: formData.typeOfInsurance,
          },
          createdAt: new Date(),
        },
      ],
    };

    console.log(`  🔨 Creating InsuranceQuery document...`);
    const insuranceQuery = new InsuranceQuery(insuranceQueryData);

    // Auto-assign lander if available
    console.log(`  🔍 Attempting to auto-assign lander...`);
    const assignedQuery = await LanderAssignmentEngine.ensureAssignment(
      insuranceQuery,
      {
        actorId: actorId,
        reason: "auto_created_from_lead",
        session,
      }
    );

    console.log(
      `  💾 Saving insurance query (with validateBeforeSave for flexibility)...`
    );
    await assignedQuery.save({ session, validateBeforeSave: false });

    console.log(`  ✅✅ Insurance query created: ${assignedQuery._id}`);
    console.log(`  📊 Insurance Query Details:`, {
      queryId: assignedQuery._id,
      insuranceType: (assignedQuery as any).typeOfInsurance,
      customerId: assignedQuery.customerId,
      assignedLander: assignedQuery.assignedLander,
      status: (assignedQuery as any).status,
      kycDocumentUrl: (assignedQuery as any).kycDocumentUrl,
    });

    return assignedQuery;
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
    console.log(`\n  👤 Ensuring borrower profile exists...`);

    if (lead.borrowerProfile) {
      console.log(
        `  🔍 Lead already has borrowerProfile: ${lead.borrowerProfile}`
      );
      const borrower = await User.findById(lead.borrowerProfile);
      if (borrower) {
        console.log(
          `  ✅ Existing borrower found: ${borrower.name} (${borrower.email})`
        );
        return borrower;
      }
      console.log(
        `  ⚠️ Borrower profile ID exists but user not found, will create/find new one`
      );
    }

    const lookup = [] as Record<string, any>[];
    if (lead.email) lookup.push({ email: lead.email });
    if (lead.mobile) lookup.push({ mobile: lead.mobile });
    console.log(`  🔍 Searching for existing user by:`, lookup);

    let borrower = lookup.length ? await User.findOne({ $or: lookup }) : null;

    const email = lead.email || `${lead.mobile}@lead.auto`;

    if (!borrower) {
      console.log(
        `  🆕 No existing user found, creating new borrower profile...`
      );
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
      console.log(
        `  ✅ New borrower profile created: ${borrower.name} (${email})`
      );
    } else {
      console.log(
        `  ✅ Found existing user: ${borrower.name} (${borrower.email})`
      );
      console.log(`  📝 Updating borrower profile if needed...`);
      borrower.name = borrower.name || lead.fullName;
      borrower.email = borrower.email || email;
    }

    console.log(`  💾 Saving borrower profile...`);
    await borrower.save({ session: options.session });
    lead.borrowerProfile = borrower._id as Types.ObjectId;
    console.log(`  ✅ Borrower profile saved: ${borrower._id}`);
    return borrower;
  }

  private async notifyInteraktLeadCreated(
    lead: ILead,
    options: CaptureLeadOptions
  ) {
    if (!config.integrations.interakt.enabled) return;

    const leadId = (lead as any)?._id?.slice(-8);
    const productLabel = (
      lead.productType ||
      lead.loanPurpose ||
      "Lead"
    ).toString();
    const { countryCode, phoneNumber } = splitInteraktPhone(
      lead.mobile,
      config.integrations.interakt.defaultCountryCode
    );
    const payload: InteraktTemplatePayload = {
      countryCode,
      phoneNumber,
      callbackData: `lead_created|${productLabel}|lead_id_${leadId}`,
      type: "Template",
      template: {
        languageCode: "en",
        name: "lead_created",
        bodyValues: [lead.fullName || "Lead", productLabel, leadId],
      },
      metadata: {
        leadId,
        leadSource: lead.capturedFrom?.platform,
        campaign:
          lead.capturedFrom?.campaignId ||
          lead.utm?.campaign ||
          lead.metadata?.campaignName,
        createdBy: options.actorId || "system",
        timestamp: new Date().toISOString(),
        stats: {
          status: lead.status,
          priority: lead.priority,
          loanAmount: lead.loanAmount,
          productType: lead.productType,
          intentScore: lead.intentScore,
        },
      },
    };

    try {
      const response = await sendInteraktTemplateMessage(payload);
      const eventTimestamp = new Date();
      try {
        await Lead.findByIdAndUpdate(
          lead._id,
          {
            $push: {
              activities: {
                type: LeadActivityType.INTEGRATION_EVENT,
                description: "Interakt lead_created message queued",
                payload: {
                  provider: "interakt",
                  status: "processed",
                  response,
                },
                createdAt: eventTimestamp,
              },
              integrationEvents: {
                provider: "interakt",
                status: "processed",
                payload,
                receivedAt: eventTimestamp,
                processedAt: eventTimestamp,
                message: response?.message || "Interakt message queued",
              },
            },
          },
          { session: options.session }
        );
      } catch (updateError) {
        console.error("Interakt log update failed:", updateError);
      }
    } catch (error: any) {
      const eventTimestamp = new Date();
      const message = error?.message || "Interakt lead_created failed.";
      try {
        await Lead.findByIdAndUpdate(
          lead._id,
          {
            $push: {
              activities: {
                type: LeadActivityType.INTEGRATION_EVENT,
                description: "Interakt lead_created failed",
                payload: {
                  provider: "interakt",
                  status: "failed",
                  error: message,
                },
                createdAt: eventTimestamp,
              },
              integrationEvents: {
                provider: "interakt",
                status: "failed",
                payload,
                receivedAt: eventTimestamp,
                processedAt: eventTimestamp,
                message,
              },
            },
          },
          { session: options.session }
        );
      } catch (updateError) {
        console.error("Interakt log update failed:", updateError);
      }
    }
  }
}

export const leadManagementService = new LeadManagementService();
