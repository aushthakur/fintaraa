import colors from "colors";
import cron from "node-cron";
import { startOfDay } from "date-fns";
import Pricing from "../modals/pricing.model";

export const startDailyPricingCron = () => {
    cron.schedule(
        "0 3 * * *",
        async () => {
            console.log(colors.cyan(`[PRICING CRON] Starting daily pricing recalculation...`));

            try {
                const today = startOfDay(new Date());
                const updatedCount = await Pricing.recalcAndUpdateAll(today);
                console.log(
                    colors.green(
                        `[PRICING CRON] Successfully updated ${updatedCount} pricing document(s) at ${new Date().toISOString()}`
                    )
                );
            } catch (error: any) {
                console.log(
                    colors.red(`[PRICING CRON] Failed at ${new Date().toISOString()}`),
                    colors.yellow(`Reason: ${error?.message || "Unknown error"}`)
                );
                if (error?.stack) console.log(colors.gray(`Stack Trace:\n${error.stack}`));
            } finally {
                console.log(colors.magenta(`[PRICING CRON] Task finished.\n`));
            }
        },
        { timezone: "UTC" }
    );
};
