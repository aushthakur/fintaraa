import mongoose from "mongoose";
import Admin from "../modals/admin.model";
import { UserType } from "../modals/notification.model";
import Lead, { LeadFollowUpStatus } from "../modals/lead.model";
import { CallRecord, ICallRecord } from "../modals/callRecord.model";
import {
  LoanFollowUpStatus,
  LoanQuery,
} from "../modals/loanquery.model";
import {
  InsuranceFollowUpStatus,
  InsuranceQuery,
} from "../modals/insurancequery.model";
import { sendSingleNotification } from "../services/notification.service";
import { getLoanTypeDisplayLabel } from "../utils/loanType";

const CHECK_INTERVAL_MINUTES = 1;
export const REMINDER_MINUTES_BEFORE = 15;
export const REMINDER_CATCH_UP_MINUTES = 60;
const INDIA_TIME_ZONE = "Asia/Kolkata";
let schedulerTimer: NodeJS.Timeout | null = null;
let reminderCycleRunning = false;

const indiaDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: INDIA_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export const getReminderWindow = (now = new Date()) => {
  return {
    start: new Date(now.getTime() - REMINDER_CATCH_UP_MINUTES * 60 * 1000),
    now,
    end: new Date(now.getTime() + REMINDER_MINUTES_BEFORE * 60 * 1000),
  };
};

const formatIndiaTime = (date?: Date | string | null) =>
  date ? indiaDateTimeFormatter.format(new Date(date)) : "scheduled time";

const formatWindowLog = (date: Date) =>
  `${formatIndiaTime(date)} (${date.toISOString()})`;

const getAdminIds = async () => {
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
    {
      $match: {
        "roleData.name": { $not: /^agent$|^lander$/i },
      },
    },
    { $project: { _id: 1 } },
  ]);
  return admins.map((admin) => admin._id.toString());
};

const toIdString = (value: any) => {
  if (!value) return "";
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  return String(value?._id || value || "").trim();
};

const getAssignedAgentIds = (record: any) => {
  const ids = new Set<string>();
  const primary = toIdString(record?.assignee);
  if (primary) ids.add(primary);

  if (Array.isArray(record?.assignees)) {
    record.assignees.forEach((assignee: any) => {
      const id = toIdString(assignee);
      if (id) ids.add(id);
    });
  }

  return Array.from(ids);
};

const getQueryAssignedAgentIds = (query: any) => {
  const ids = new Set<string>();
  [
    query?.nextFollowUp?.assignedTo,
    query?.assignedAgent,
    ...(Array.isArray(query?.assignedAgents) ? query.assignedAgents : []),
  ].forEach((assignee) => {
    const id = toIdString(assignee);
    if (id) ids.add(id);
  });
  return Array.from(ids);
};

const notifyFollowUpRecipients = async ({
  assignedAgentIds,
  adminIds,
  context,
  referenceLabel,
  dedupePrefix,
}: {
  assignedAgentIds: string[];
  adminIds: string[];
  context: Record<string, any>;
  referenceLabel: string;
  dedupePrefix: string;
}) => {
  const assignedIds = new Set(assignedAgentIds);
  const broadcastAdminIds = adminIds.filter((adminId) => !assignedIds.has(adminId));
  const agentResults = await Promise.allSettled(
    assignedAgentIds.map((assigneeId) =>
      sendSingleNotification({
        type: "follow-up-reminder",
        toUserId: assigneeId,
        toRole: UserType.AGENT,
        context,
        dedupeKey: `${dedupePrefix}:agent:${assigneeId}`,
      }),
    ),
  );
  const adminResults = await Promise.allSettled(
    broadcastAdminIds.map((adminId) =>
      sendSingleNotification({
        type: "follow-up-reminder",
        toUserId: adminId,
        toRole: UserType.ADMIN,
        context,
        dedupeKey: `${dedupePrefix}:admin:${adminId}`,
      }),
    ),
  );

  [...agentResults, ...adminResults].forEach((result) => {
    if (result.status === "rejected") {
      console.error(
        `[FollowUpReminder] Notification failed for ${referenceLabel}:`,
        result.reason,
      );
    }
  });
  return [...agentResults, ...adminResults].filter(
    (result) => result.status === "fulfilled" && Boolean(result.value),
  ).length;
};

/**
 * Process callback reminders - sends notifications to agents and admins
 * for call records with callbacks scheduled in 15 minutes.
 */
export const processCallbackReminders = async (): Promise<void> => {
  try {
    const {
      start: reminderWindowStart,
      now,
      end: reminderWindowEnd,
    } =
      getReminderWindow();
    const baseFilter = {
      followUp: true,
      callbackAt: {
        $gt: reminderWindowStart,
        $lte: reminderWindowEnd,
      },
    };
    const notNotifiedFilter = {
      $or: [
        { callbackNotifiedAt: { $exists: false } },
        { callbackNotifiedAt: null },
      ],
    };

    console.log(
      `[CallbackReminder] Window IST ${formatWindowLog(reminderWindowStart)} -> ${formatWindowLog(reminderWindowEnd)}`,
    );

    // Find upcoming callbacks now within the 15-minute reminder horizon.
    const callRecords = await CallRecord.find({
      ...baseFilter,
      ...notNotifiedFilter,
    }).lean();

    if (callRecords.length === 0) {
      const [windowTotal, nextCallbacks] = await Promise.all([
        CallRecord.countDocuments(baseFilter),
        CallRecord.find({
          callbackAt: { $gt: now },
        })
          .select("_id phoneNumber firstName lastName productService callbackAt callbackNotifiedAt")
          .sort({ callbackAt: 1 })
          .limit(5)
          .lean(),
      ]);
      const nextSummary = nextCallbacks
        .map((record: any) => {
          const callbackAt = record?.callbackAt
            ? new Date(record.callbackAt)
            : null;
          const minutesAway = callbackAt
            ? Math.round(
                (callbackAt.getTime() - now.getTime()) /
                  60000,
              )
            : "-";
          return `${record._id} at ${formatIndiaTime(record.callbackAt)} (${minutesAway}m) notified=${Boolean(record.callbackNotifiedAt)}`;
        })
        .join(" | ");

      console.log(
        `[CallbackReminder] No callbacks to remind. inWindow=${windowTotal}, next=${nextSummary || "none"}`,
      );
      return;
    }

    console.log(
      `[CallbackReminder] Found ${callRecords.length} callbacks to remind: ${callRecords
        .map((record: any) => `${record._id}@${formatIndiaTime(record.callbackAt)}`)
        .join(", ")}`,
    );

    const adminIds = await getAdminIds();

    // Process each call record
    for (const record of callRecords) {
      try {
        const recordId =
          record._id instanceof mongoose.Types.ObjectId
            ? record._id.toString()
            : (record._id as string);

        const context = {
          phone: record.phoneNumber,
          name:
            `${record.firstName || ""} ${record.lastName || ""}`.trim() ||
            record.phoneNumber,
          product: record.productService || "Call Record",
          callbackTime: formatIndiaTime(record.callbackAt),
        };

        const assignedAgentIds = getAssignedAgentIds(record);
        const assignedIds = new Set(assignedAgentIds);
        const broadcastAdminIds = adminIds.filter(
          (adminId) => !assignedIds.has(adminId),
        );

        let persistedNotifications = 0;
        for (const assigneeId of assignedAgentIds) {
          try {
            await sendSingleNotification({
              type: "callback-reminder",
              toUserId: assigneeId,
              toRole: UserType.AGENT,
              context,
              dedupeKey: `callback:${recordId}:agent:${assigneeId}`,
            });
            persistedNotifications += 1;
            console.log(
              `[CallbackReminder] Notified assigned agent ${assigneeId} for callback ${recordId}`,
            );
          } catch (error) {
            console.error(
              `[CallbackReminder] Error notifying assigned agent ${assigneeId}:`,
              error,
            );
          }
        }

        // Send notifications to all admins
        for (const adminId of broadcastAdminIds) {
          try {
            await sendSingleNotification({
              type: "callback-reminder",
              toUserId: adminId,
              toRole: UserType.ADMIN,
              context,
              dedupeKey: `callback:${recordId}:admin:${adminId}`,
            });
            persistedNotifications += 1;
          } catch (error) {
            console.error(
              `[CallbackReminder] Error notifying admin ${adminId}:`,
              error,
            );
          }
        }
        console.log(
          `[CallbackReminder] Notified ${broadcastAdminIds.length} additional admins for callback ${recordId}`,
        );

        if (persistedNotifications > 0) {
          await CallRecord.updateOne(
            {
              _id: recordId,
              $or: [
                { callbackNotifiedAt: { $exists: false } },
                { callbackNotifiedAt: null },
              ],
            },
            { callbackNotifiedAt: new Date() },
          );
        }
      } catch (error) {
        console.error(
          `[CallbackReminder] Error processing callback ${record._id}:`,
          error,
        );
      }
    }

    console.log(
      `[CallbackReminder] Processed ${callRecords.length} callback reminders`,
    );
  } catch (error) {
    console.error(
      "[CallbackReminder] Error in callback reminder process:",
      error,
    );
  }
};

/**
 * Process lead follow-up reminders using the same 15-minute reminder window.
 */
export const processLeadFollowUpReminders = async (): Promise<void> => {
  try {
    const { start: reminderWindowStart, end: reminderWindowEnd } =
      getReminderWindow();

    const leads = await Lead.find({
      followUps: {
        $elemMatch: {
          status: LeadFollowUpStatus.PENDING,
          $and: [
            {
              $or: [
                {
                  reminderAt: {
                    $gt: reminderWindowStart,
                    $lte: reminderWindowEnd,
                  },
                },
                {
                  reminderAt: null,
                  dueAt: {
                    $gt: reminderWindowStart,
                    $lte: reminderWindowEnd,
                  },
                },
                {
                  reminderAt: { $exists: false },
                  dueAt: {
                    $gt: reminderWindowStart,
                    $lte: reminderWindowEnd,
                  },
                },
              ],
            },
          ],
          $or: [
            { reminderNotifiedAt: { $exists: false } },
            { reminderNotifiedAt: null },
          ],
        },
      },
    })
      .select("fullName mobile productType assignment.current followUps")
      .lean();

    if (leads.length === 0) {
      console.log("[FollowUpReminder] No follow-ups to remind about");
      return;
    }

    const adminIds = await getAdminIds();
    let processedCount = 0;

    for (const lead of leads) {
      const followUps = ((lead.followUps || []) as any[]).filter(
        (followUp) =>
          followUp?.status === LeadFollowUpStatus.PENDING &&
          !followUp?.reminderNotifiedAt &&
          (followUp?.reminderAt || followUp?.dueAt) &&
          new Date(followUp.reminderAt || followUp.dueAt) >
            reminderWindowStart &&
          new Date(followUp.reminderAt || followUp.dueAt) <= reminderWindowEnd,
      );

      for (const followUp of followUps) {
        try {
          const leadId =
            lead._id instanceof mongoose.Types.ObjectId
              ? lead._id.toString()
              : (lead._id as string);
          const followUpId =
            followUp._id instanceof mongoose.Types.ObjectId
              ? followUp._id.toString()
              : (followUp._id as string);
          const assignee = lead.assignment?.current?.agent;
          const assigneeId = assignee
            ? assignee instanceof mongoose.Types.ObjectId
              ? assignee.toString()
              : (assignee as string)
            : null;
          const broadcastAdminIds = adminIds.filter(
            (adminId) => adminId !== assigneeId,
          );

          const context = {
            name: lead.fullName || lead.mobile || "Lead",
            phone: lead.mobile,
            product: lead.productType || "Lead",
            followUpTime: formatIndiaTime(
              followUp.reminderAt || followUp.dueAt,
            ),
          };

          let persistedNotifications = 0;
          if (assigneeId) {
            await sendSingleNotification({
              type: "follow-up-reminder",
              toUserId: assigneeId,
              toRole: UserType.AGENT,
              context,
              dedupeKey: `lead-follow-up:${leadId}:${followUpId}:agent:${assigneeId}`,
            });
            persistedNotifications += 1;
          }

          for (const adminId of broadcastAdminIds) {
            try {
              await sendSingleNotification({
                type: "follow-up-reminder",
                toUserId: adminId,
                toRole: UserType.ADMIN,
                context,
                dedupeKey: `lead-follow-up:${leadId}:${followUpId}:admin:${adminId}`,
              });
              persistedNotifications += 1;
            } catch (error) {
              console.error(
                `[FollowUpReminder] Error notifying admin ${adminId}:`,
                error,
              );
            }
          }

          if (persistedNotifications > 0) {
            await Lead.updateOne(
              {
                _id: leadId,
                followUps: {
                  $elemMatch: {
                    _id: followUpId,
                    $or: [
                      { reminderNotifiedAt: { $exists: false } },
                      { reminderNotifiedAt: null },
                    ],
                  },
                },
              },
              { $set: { "followUps.$.reminderNotifiedAt": new Date() } },
            );
            processedCount += 1;
          }
        } catch (error) {
          console.error(
            `[FollowUpReminder] Error processing follow-up ${followUp?._id}:`,
            error,
          );
        }
      }
    }

    console.log(
      `[FollowUpReminder] Processed ${processedCount} follow-up reminders`,
    );
  } catch (error) {
    console.error("[FollowUpReminder] Error in reminder process:", error);
  }
};

/**
 * Process the dedicated follow-up fields stored on LoanQuery records.
 */
export const processLoanQueryFollowUpReminders = async (): Promise<void> => {
  try {
    const { start, end } = getReminderWindow();
    const queries = await LoanQuery.find({
      followUpEnabled: true,
      "nextFollowUp.status": LoanFollowUpStatus.PENDING,
      "nextFollowUp.dueAt": { $gt: start, $lte: end },
      $or: [
        { "nextFollowUp.reminderNotifiedAt": { $exists: false } },
        { "nextFollowUp.reminderNotifiedAt": null },
      ],
    })
      .select(
        "loanId loanType policyDetails.productVariant policyDetails.metaFlowKey policyDetails.requestedProductName policyDetails.requestedProductSlug policyDetails.productLabel firstName lastName mobile assignedAgent assignedAgents nextFollowUp",
      )
      .lean();

    if (!queries.length) return;
    const adminIds = await getAdminIds();

    for (const query of queries) {
      const queryId = toIdString(query._id);
      const dueAt = query.nextFollowUp?.dueAt;
      const context = {
        name:
          `${query.firstName || ""} ${query.lastName || ""}`.trim() ||
          query.mobile ||
          "Loan customer",
        phone: query.mobile,
        product: getLoanTypeDisplayLabel(query.loanType, query.policyDetails),
        followUpTime: formatIndiaTime(dueAt),
      };

      const persistedNotifications = await notifyFollowUpRecipients({
        assignedAgentIds: getQueryAssignedAgentIds(query),
        adminIds,
        context,
        referenceLabel: `loan ${query.loanId || queryId}`,
        dedupePrefix: `loan-follow-up:${queryId}:${String(dueAt)}`,
      });
      if (persistedNotifications > 0) await LoanQuery.updateOne(
        {
          _id: query._id,
          "nextFollowUp.status": LoanFollowUpStatus.PENDING,
          $or: [
            { "nextFollowUp.reminderNotifiedAt": { $exists: false } },
            { "nextFollowUp.reminderNotifiedAt": null },
          ],
        },
        { $set: { "nextFollowUp.reminderNotifiedAt": new Date() } },
      );
    }
  } catch (error) {
    console.error("[LoanFollowUpReminder] Error in reminder process:", error);
  }
};

/**
 * Process the dedicated follow-up fields stored on InsuranceQuery records.
 */
export const processInsuranceQueryFollowUpReminders =
  async (): Promise<void> => {
    try {
      const { start, end } = getReminderWindow();
      const queries = await InsuranceQuery.find({
        followUpEnabled: true,
        "nextFollowUp.status": InsuranceFollowUpStatus.PENDING,
        "nextFollowUp.dueAt": { $gt: start, $lte: end },
        $or: [
          { "nextFollowUp.reminderNotifiedAt": { $exists: false } },
          { "nextFollowUp.reminderNotifiedAt": null },
        ],
      })
        .select(
          "typeOfInsurance firstName lastName mobile assignedAgent assignedAgents nextFollowUp",
        )
        .lean();

      if (!queries.length) return;
      const adminIds = await getAdminIds();

      for (const query of queries) {
        const queryId = toIdString(query._id);
        const dueAt = query.nextFollowUp?.dueAt;
        const context = {
          name:
            `${query.firstName || ""} ${query.lastName || ""}`.trim() ||
            query.mobile ||
            "Insurance customer",
          phone: query.mobile,
          product: String(query.typeOfInsurance || "Insurance").replace(
            /_/g,
            " ",
          ),
          followUpTime: formatIndiaTime(dueAt),
        };

        const persistedNotifications = await notifyFollowUpRecipients({
          assignedAgentIds: getQueryAssignedAgentIds(query),
          adminIds,
          context,
          referenceLabel: `insurance ${queryId}`,
          dedupePrefix: `insurance-follow-up:${queryId}:${String(dueAt)}`,
        });
        if (persistedNotifications > 0) await InsuranceQuery.updateOne(
          {
            _id: query._id,
            "nextFollowUp.status": InsuranceFollowUpStatus.PENDING,
            $or: [
              { "nextFollowUp.reminderNotifiedAt": { $exists: false } },
              { "nextFollowUp.reminderNotifiedAt": null },
            ],
          },
          { $set: { "nextFollowUp.reminderNotifiedAt": new Date() } },
        );
      }
    } catch (error) {
      console.error(
        "[InsuranceFollowUpReminder] Error in reminder process:",
        error,
      );
    }
  };

/**
 * Start the callback reminder scheduler
 * Runs every minute to check for upcoming callbacks
 */
export const startCallbackReminderScheduler = (): NodeJS.Timeout => {
  if (schedulerTimer) return schedulerTimer;
  console.log(
    `[CallbackReminder] Scheduler started - checking every ${CHECK_INTERVAL_MINUTES} minute(s), aligned to minute boundary`,
  );

  const run = async () => {
    if (reminderCycleRunning) {
      console.log("[CallbackReminder] Previous reminder cycle is still running; skipping overlap");
      return;
    }
    reminderCycleRunning = true;
    try {
      await Promise.allSettled([
        processCallbackReminders(),
        processLeadFollowUpReminders(),
        processLoanQueryFollowUpReminders(),
        processInsuranceQueryFollowUpReminders(),
      ]);
    } finally {
      reminderCycleRunning = false;
    }
  };

  // Run immediately on start.
  void run();

  const intervalMs = CHECK_INTERVAL_MINUTES * 60 * 1000;
  const msUntilNextMinute = intervalMs - (Date.now() % intervalMs);
  schedulerTimer = setTimeout(() => {
    void run();
    schedulerTimer = setInterval(() => void run(), intervalMs);
  }, msUntilNextMinute);

  return schedulerTimer;
};

export default {
  processCallbackReminders,
  processLeadFollowUpReminders,
  processLoanQueryFollowUpReminders,
  processInsuranceQueryFollowUpReminders,
  startCallbackReminderScheduler,
};
