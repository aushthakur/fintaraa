import mongoose from "mongoose";
import Admin from "../modals/admin.model";
import { UserType } from "../modals/notification.model";
import { CallRecord, ICallRecord } from "../modals/callRecord.model";
import { sendSingleNotification } from "../services/notification.service";

const CHECK_INTERVAL_MINUTES = 1;
const REMINDER_MINUTES_BEFORE = 5;

/**
 * Process callback reminders - sends notifications to agents and admins
 * for call records with callbacks scheduled in the next 5 minutes
 */
export const processCallbackReminders = async (): Promise<void> => {
  try {
    const now = new Date();
    const reminderWindowStart = new Date(
      now.getTime() + (REMINDER_MINUTES_BEFORE - 1) * 60 * 1000,
    ); // 4 minutes from now
    const reminderWindowEnd = new Date(
      now.getTime() + (REMINDER_MINUTES_BEFORE + 1) * 60 * 1000,
    ); // 6 minutes from now

    // Find call records with callbacks in the reminder window that haven't been notified yet
    const callRecords = await CallRecord.find({
      callbackAt: {
        $gte: reminderWindowStart,
        $lte: reminderWindowEnd,
      },
      callbackNotifiedAt: { $exists: false },
    }).lean();

    if (callRecords.length === 0) {
      console.log("[CallbackReminder] No callbacks to remind about");
      return;
    }

    console.log(
      `[CallbackReminder] Found ${callRecords.length} callbacks to remind`,
    );

    // Get all admin users to notify
    const admins = await Admin.find({ role: { $in: ["admin", "manager"] } })
      .select("_id")
      .lean();
    const adminIds = admins.map((admin) => admin._id.toString());

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
          callbackTime: record.callbackAt
            ? new Date(record.callbackAt).toLocaleString()
            : "scheduled time",
        };

        // Get agent ID if assignee exists
        const assigneeId = record.assignee
          ? record.assignee instanceof mongoose.Types.ObjectId
            ? record.assignee.toString()
            : (record.assignee as string)
          : null;

        // Send notification to assigned agent
        if (assigneeId) {
          await sendSingleNotification({
            type: "callback-reminder",
            toUserId: assigneeId,
            toRole: UserType.AGENT,
            context,
          });
          console.log(
            `[CallbackReminder] Notified agent ${assigneeId} for callback ${recordId}`,
          );
        }

        // Send notifications to all admins
        for (const adminId of adminIds) {
          try {
            await sendSingleNotification({
              type: "callback-reminder",
              toUserId: adminId,
              toRole: UserType.ADMIN,
              context,
            });
          } catch (error) {
            console.error(
              `[CallbackReminder] Error notifying admin ${adminId}:`,
              error,
            );
          }
        }
        console.log(
          `[CallbackReminder] Notified ${adminIds.length} admins for callback ${recordId}`,
        );

        // Update the record to mark as notified
        await CallRecord.findByIdAndUpdate(recordId, {
          callbackNotifiedAt: new Date(),
        });
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
 * Start the callback reminder scheduler
 * Runs every minute to check for upcoming callbacks
 */
export const startCallbackReminderScheduler = (): NodeJS.Timeout => {
  console.log(
    `[CallbackReminder] Scheduler started - checking every ${CHECK_INTERVAL_MINUTES} minute(s)`,
  );

  // Run immediately on start
  processCallbackReminders();

  // Then run every minute
  return setInterval(
    () => {
      processCallbackReminders();
    },
    CHECK_INTERVAL_MINUTES * 60 * 1000,
  );
};

export default {
  processCallbackReminders,
  startCallbackReminderScheduler,
};
