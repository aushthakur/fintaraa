import crypto from "crypto";
import mongoose from "mongoose";
import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { User } from "../../modals/user.model";
import { LoanQuery } from "../../modals/loanquery.model";
import {
  CommunicationChannel,
  CommunicationOutbox,
  CommunicationOutboxStatus,
} from "../../modals/communicationOutbox.model";
import { config } from "../../config/config";
import { PushCampaignTarget } from "../../modals/pushCampaign.model";
import { createPushCampaign } from "../../services/pushCampaign.service";

type Channel = "email" | "sms" | "whatsapp" | "push";
type AudienceMode = "selected" | "filtered" | "all" | "custom";

const clean = (value: unknown, max = 5000) =>
  String(value || "").trim().slice(0, max);

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const safeActionUrl = (value: unknown) => {
  const actionUrl = clean(value, 1000);
  if (!actionUrl || (actionUrl.startsWith("/") && !actionUrl.startsWith("//"))) {
    return actionUrl;
  }
  try {
    const parsed = new URL(actionUrl);
    if (["http:", "https:"].includes(parsed.protocol)) return actionUrl;
  } catch {
    // The validation error below is returned to the admin.
  }
  throw new ApiError(400, "Push link must be a site path or HTTP(S) URL.");
};

const selectedChannels = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => clean(item, 20).toLowerCase())
        .filter((item): item is Channel =>
          ["email", "sms", "whatsapp", "push"].includes(item),
        ),
    ),
  );

const replaceTokens = (template: string, user: any, message = "") => {
  const values: Record<string, string> = {
    name: clean(user?.name, 160) || "Customer",
    email: clean(user?.email, 200),
    mobile: clean(user?.mobile, 30),
    customerId: clean(user?.customerId || user?._id, 80),
    message,
  };
  return Object.entries(values).reduce(
    (result, [key, value]) =>
      result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "gi"), value),
    template,
  );
};

const audienceQuery = (searchValue: unknown) => {
  const search = clean(searchValue, 100);
  const query: Record<string, unknown> = {
    role: "user",
    isDeleted: { $ne: true },
  };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { name: pattern },
      { email: pattern },
      { mobile: pattern },
      { customerId: pattern },
    ];
  }
  return query;
};

const addAndCondition = (
  query: Record<string, any>,
  condition: Record<string, any>,
) => {
  query.$and = Array.isArray(query.$and) ? query.$and : [];
  query.$and.push(condition);
};

const buildCampaignAudienceQuery = async (body: any) => {
  const audienceMode = clean(body?.audienceMode, 20).toLowerCase() as AudienceMode;
  const mode: AudienceMode = ["selected", "filtered", "all", "custom"].includes(
    audienceMode,
  )
    ? audienceMode
    : "selected";
  const query: Record<string, any> = {
    role: "user",
    isDeleted: { $ne: true },
  };

  if (mode === "selected") {
    const customerIds = Array.from(
      new Set(
        (Array.isArray(body?.customerIds) ? body.customerIds : [])
          .map((value: unknown) => clean(value, 80))
          .filter((value: string) => mongoose.isValidObjectId(value)),
      ),
    );
    if (!customerIds.length) {
      throw new ApiError(400, "Select at least one customer.");
    }
    query._id = { $in: customerIds };
    return { mode, query };
  }

  if (mode === "custom") {
    const identifiers = Array.from(
      new Set<string>(
        (Array.isArray(body?.customRecipients) ? body.customRecipients : [])
          .map((value: unknown) => clean(value, 240))
          .filter((value: string) => Boolean(value)),
      ),
    ).slice(0, 50_000);
    const objectIds = identifiers.filter((value) =>
      mongoose.isValidObjectId(value),
    );
    const emails = identifiers
      .filter((value) => value.includes("@"))
      .map((value) => value.toLowerCase());
    const mobiles = identifiers
      .map((value) => value.replace(/\D/g, ""))
      .filter((value) => value.length >= 10);
    const customerIds = identifiers.filter(
      (value) => !value.includes("@") && !mongoose.isValidObjectId(value),
    );
    const identityQueries: Record<string, any>[] = [];
    if (objectIds.length) identityQueries.push({ _id: { $in: objectIds } });
    if (emails.length) identityQueries.push({ email: { $in: emails } });
    if (mobiles.length) {
      identityQueries.push({
        mobile: {
          $in: Array.from(
            new Set([...mobiles, ...mobiles.map((value) => value.slice(-10))]),
          ),
        },
      });
    }
    if (customerIds.length) {
      identityQueries.push({ customerId: { $in: customerIds } });
    }
    if (!identityQueries.length) {
      throw new ApiError(400, "Uploaded list has no valid customer identifiers.");
    }
    query.$or = identityQueries;
    return { mode, query };
  }

  const filters = body?.filters || {};
  const accountStatus = clean(filters.accountStatus || filters.status, 80)
    .toLowerCase();
  if (accountStatus && accountStatus !== "all") query.status = accountStatus;

  const registrationSource = clean(filters.registrationSource, 80).toLowerCase();
  if (registrationSource && registrationSource !== "all") {
    if (registrationSource === "referral") {
      addAndCondition(query, {
        $or: [
          { registrationSource: "referral" },
          { referredBy: { $exists: true, $ne: null } },
        ],
      });
    } else if (["app", "website"].includes(registrationSource)) {
      addAndCondition(query, {
        $or: [
          { registrationSource },
          {
            registrationSource: { $in: ["unknown", null, ""] },
            accountSource: registrationSource,
          },
          {
            registrationSource: { $exists: false },
            accountSource: registrationSource,
          },
        ],
      });
    } else if (registrationSource === "unknown") {
      addAndCondition(query, {
        $or: [
          { registrationSource: "unknown" },
          { registrationSource: { $exists: false } },
          { registrationSource: null },
          { registrationSource: "" },
        ],
      });
    } else {
      query.registrationSource = registrationSource;
    }
  }

  const city = clean(filters.city, 120);
  if (city) {
    const cityPattern = new RegExp(escapeRegex(city), "i");
    addAndCondition(query, {
      $or: [
        { "addresses.city": cityPattern },
        { "kycProfile.personalDetails.city": cityPattern },
      ],
    });
  }

  const loanType = clean(filters.loanType, 160);
  const applicationStatus = clean(filters.applicationStatus, 100).toLowerCase();
  if (loanType || applicationStatus) {
    const loanQuery: Record<string, any> = { isDeleted: { $ne: true } };
    if (loanType) loanQuery.loanType = loanType;
    if (applicationStatus) loanQuery.status = applicationStatus;
    const customerIds = await LoanQuery.distinct("customerId", loanQuery);
    addAndCondition(query, { _id: { $in: customerIds } });
  }

  return { mode, query };
};

const writeOperations = async (operations: any[]) => {
  const chunkSize = 1000;
  for (let index = 0; index < operations.length; index += chunkSize) {
    await CommunicationOutbox.bulkWrite(
      operations.slice(index, index + chunkSize),
      { ordered: false },
    );
  }
};

export class BulkCommunicationController {
  static async audience(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const query = audienceQuery(req.query.search);
      const [items, total] = await Promise.all([
        User.find(query)
          .select("name email mobile customerId notification createdAt")
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        User.countDocuments(query),
      ]);
      return res.status(200).json(
        new ApiResponse(
          200,
          { items, total, limit },
          "Bulk communication audience fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const channels = selectedChannels(req.body?.channels);
      if (!channels.length) {
        return res
          .status(400)
          .json(new ApiError(400, "Select at least one communication channel."));
      }
      const audience = await buildCampaignAudienceQuery(req.body || {});

      const emailSubject = clean(req.body?.emailSubject, 180);
      const emailHtml = clean(req.body?.emailHtml, 100_000);
      const smsTemplateId = clean(req.body?.smsTemplateId, 160);
      const smsMessage = clean(req.body?.smsMessage, 2000);
      const whatsappTemplateName = clean(
        req.body?.whatsappTemplateName,
        160,
      );
      const whatsappLanguage = clean(req.body?.whatsappLanguage, 20) || "en";
      const whatsappMessage = clean(req.body?.whatsappMessage, 1000);
      const pushTitle = clean(req.body?.pushTitle, 120);
      const pushMessage = clean(req.body?.pushMessage, 1000);
      const pushActionUrl = safeActionUrl(req.body?.pushActionUrl);
      const whatsappBodyTemplates: string[] = (
        Array.isArray(req.body?.whatsappBodyValues)
          ? req.body.whatsappBodyValues
          : []
      )
        .map((item: unknown) => clean(item, 1000))
        .filter(Boolean)
        .slice(0, 20);

      if (channels.includes("email") && (!emailSubject || !emailHtml)) {
        return res
          .status(400)
          .json(new ApiError(400, "Email subject and HTML are required."));
      }
      if (
        channels.includes("sms") &&
        (!config.sms.enabled || !smsTemplateId || !smsMessage)
      ) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Enable SMS and enter the exact approved DLT template ID and text.",
            ),
          );
      }
      if (
        channels.includes("whatsapp") &&
        (!config.integrations.interakt.enabled ||
          !whatsappTemplateName ||
          !whatsappBodyTemplates.length)
      ) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Enable Interakt and enter an approved template name with body values.",
            ),
          );
      }
      if (channels.includes("push") && (!pushTitle || !pushMessage)) {
        return res
          .status(400)
          .json(new ApiError(400, "Push title and message are required."));
      }

      const users = await User.find(audience.query)
        .select("name email mobile customerId notification")
        .lean();
      if (!users.length) {
        return res
          .status(400)
          .json(new ApiError(400, "No platform users match this audience."));
      }
      const campaignId = crypto.randomUUID();
      const operations: any[] = [];
      const queued: Record<Channel, number> = {
        email: 0,
        sms: 0,
        whatsapp: 0,
        push: 0,
      };
      const skipped: Record<Channel, number> = {
        email: 0,
        sms: 0,
        whatsapp: 0,
        push: 0,
      };
      const preferenceUrl = `${String(config.publicWebsiteUrl || "https://fintaraa.com").replace(/\/+$/, "")}/account/profile/notification-preferences`;

      users.forEach((user: any) => {
        const userId = String(user._id);
        if (channels.includes("email")) {
          if (user.email && user.notification?.email !== false) {
            const html = `${replaceTokens(emailHtml, user)}<p style="font:12px Arial,sans-serif;color:#64748b;margin-top:28px">Manage communication preferences: <a href="${preferenceUrl}">${preferenceUrl}</a></p>`;
            operations.push({
              insertOne: {
                document: {
                  channel: CommunicationChannel.EMAIL,
                  eventName: "admin-bulk-campaign",
                  referenceId: campaignId,
                  recipient: user.email,
                  payload: {
                    to: user.email,
                    subject: replaceTokens(emailSubject, user),
                    html,
                  },
                  idempotencyKey: `bulk:${campaignId}:${userId}:email`,
                  status: CommunicationOutboxStatus.PENDING,
                  attempts: 0,
                  maxAttempts: 4,
                  nextAttemptAt: new Date(),
                },
              },
            });
            queued.email += 1;
          } else skipped.email += 1;
        }

        if (channels.includes("sms")) {
          if (user.mobile && user.notification?.sms !== false) {
            operations.push({
              insertOne: {
                document: {
                  channel: CommunicationChannel.SMS,
                  eventName: "admin-bulk-campaign",
                  referenceId: campaignId,
                  recipient: user.mobile,
                  payload: {
                    to: user.mobile,
                    message: smsMessage,
                    templateId: smsTemplateId,
                    variables: {
                      name: user.name || "Customer",
                      customerId: user.customerId || userId,
                    },
                  },
                  idempotencyKey: `bulk:${campaignId}:${userId}:sms`,
                  status: CommunicationOutboxStatus.PENDING,
                  attempts: 0,
                  maxAttempts: 4,
                  nextAttemptAt: new Date(),
                },
              },
            });
            queued.sms += 1;
          } else skipped.sms += 1;
        }

        if (channels.includes("whatsapp")) {
          if (user.mobile && user.notification?.whatsapp === true) {
            const bodyValues = whatsappBodyTemplates.map((template: string) =>
              replaceTokens(template, user, whatsappMessage),
            );
            operations.push({
              insertOne: {
                document: {
                  channel: CommunicationChannel.WHATSAPP,
                  eventName: "admin-bulk-campaign",
                  referenceId: campaignId,
                  recipient: user.mobile,
                  payload: {
                    countryCode:
                      config.integrations.interakt.defaultCountryCode,
                    phoneNumber: user.mobile,
                    type: "Template",
                    callbackData: `bulk:${campaignId}:${userId}`,
                    template: {
                      name: whatsappTemplateName,
                      languageCode: whatsappLanguage,
                      bodyValues,
                    },
                  },
                  idempotencyKey: `bulk:${campaignId}:${userId}:whatsapp`,
                  status: CommunicationOutboxStatus.PENDING,
                  attempts: 0,
                  maxAttempts: 4,
                  nextAttemptAt: new Date(),
                },
              },
            });
            queued.whatsapp += 1;
          } else skipped.whatsapp += 1;
        }
      });

      if (operations.length) await writeOperations(operations);

      let pushCampaignId = "";
      if (channels.includes("push")) {
        const createdBy = String(
          (req as any).user?._id || (req as any).user?.id || "",
        );
        if (!mongoose.isValidObjectId(createdBy)) {
          return res.status(401).json(new ApiError(401, "Unauthorized"));
        }
        const requestedTargets = (
          Array.isArray(req.body?.pushTargets) ? req.body.pushTargets : []
        )
          .map((value: unknown) => clean(value, 30))
          .filter((value: string) =>
            [PushCampaignTarget.B2C_APP, PushCampaignTarget.WEBSITE].includes(
              value as PushCampaignTarget,
            ),
          ) as PushCampaignTarget[];
        const targets = requestedTargets.length
          ? Array.from(new Set(requestedTargets))
          : [PushCampaignTarget.B2C_APP, PushCampaignTarget.WEBSITE];
        const pushCampaign = await createPushCampaign({
          title: pushTitle,
          message: pushMessage,
          actionUrl: pushActionUrl,
          targets,
          createdBy,
          recipientIds: users.map((user: any) => String(user._id)),
        });
        pushCampaignId = String(pushCampaign._id);
        queued.push = Number(pushCampaign.totalRecipients || 0);
        skipped.push = Math.max(users.length - queued.push, 0);
      }

      const totalQueued = Object.values(queued).reduce(
        (total, count) => total + count,
        0,
      );
      if (!totalQueued) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Matched customers have no eligible consented destinations.",
            ),
          );
      }
      return res.status(201).json(
        new ApiResponse(
          201,
          {
            campaignId,
            pushCampaignId: pushCampaignId || undefined,
            audienceMode: audience.mode,
            selectedCustomers: users.length,
            queued,
            skipped,
          },
          `${totalQueued} communication(s) queued successfully.`,
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}
