import { Types } from "mongoose";
import Ticket from "../../modals/ticket.model";
import { Request, Response, NextFunction } from "express";

const SUPPORT_TICKET_STATUSES = [
  "open",
  "in_progress",
  "on_hold",
  "re_assigned",
  "resolved",
  "closed",
];

const roundToTwo = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

export class DashboardController {
  static async getCustomerSupportSummary(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { startDate, endDate, assigneeId } = req.query;

      const parseDate = (value: unknown, fallback: Date) => {
        if (typeof value === "string" && value.trim()) {
          const parsed = new Date(value);
          if (!Number.isNaN(parsed.getTime())) {
            return parsed;
          }
        }
        return fallback;
      };

      const defaultEnd = new Date();
      const end = parseDate(endDate, defaultEnd);
      end.setHours(23, 59, 59, 999);

      const defaultStart = new Date(end);
      defaultStart.setDate(defaultStart.getDate() - 7);
      defaultStart.setHours(0, 0, 0, 0);

      const start = parseDate(startDate, defaultStart);
      start.setHours(0, 0, 0, 0);

      if (start > end) {
        const temp = new Date(start);
        start.setTime(end.getTime());
        end.setTime(temp.getTime());
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
      }

      const duration = Math.max(end.getTime() - start.getTime(), 0);
      const prevEnd = new Date(start.getTime() - 1);
      prevEnd.setHours(23, 59, 59, 999);
      const prevStart = new Date(prevEnd.getTime() - duration);
      prevStart.setHours(0, 0, 0, 0);

      const buildMatchStage = (rangeStart: Date, rangeEnd: Date) => {
        const match: Record<string, any> = {
          createdAt: { $gte: rangeStart, $lte: rangeEnd },
        };

        if (typeof assigneeId === "string" && assigneeId.trim()) {
          if (assigneeId === "unassigned") {
            match.$or = [{ assignee: { $exists: false } }, { assignee: null }];
          } else if (Types.ObjectId.isValid(assigneeId)) {
            match.assignee = new Types.ObjectId(assigneeId);
          }
        }

        return match;
      };

      const currentMatch = buildMatchStage(start, end);
      const previousMatch = buildMatchStage(prevStart, prevEnd);

      const [currentStatusAgg, previousStatusAgg, priorityAgg, ticketDocs] =
        await Promise.all([
          Ticket.aggregate([
            { $match: currentMatch },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]),
          Ticket.aggregate([
            { $match: previousMatch },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]),
          Ticket.aggregate([
            { $match: currentMatch },
            {
              $group: {
                _id: { $ifNull: ["$priority", "unknown"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ]),
          Ticket.find(buildMatchStage(start, end))
            .select(
              "title status priority tags assignee requester createdAt updatedAt"
            )
            .populate("assignee", "name email")
            .populate("requester", "fullName email")
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
        ]);

      const toCountMap = (
        aggregates: Array<{ _id: string | null; count: number }>
      ) =>
        aggregates.reduce<Record<string, number>>((acc, entry) => {
          if (entry?._id) {
            acc[entry._id] = entry.count;
          }
          return acc;
        }, {});

      const currentCounts = toCountMap(currentStatusAgg);
      const previousCounts = toCountMap(previousStatusAgg);

      const calcTrend = (current: number, previous: number) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }
        return ((current - previous) / previous) * 100;
      };

      const payload: Record<string, any> = {
        from: start.toISOString(),
        to: end.toISOString(),
        previousRange: {
          from: prevStart.toISOString(),
          to: prevEnd.toISOString(),
        },
        filters: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          assigneeId:
            typeof assigneeId === "string" && Types.ObjectId.isValid(assigneeId)
              ? assigneeId
              : assigneeId === "unassigned"
              ? "unassigned"
              : null,
        },
      };

      const statusBreakdown: Array<{ status: string; count: number }> = [];

      let totalCurrent = 0;
      let totalPrevious = 0;

      SUPPORT_TICKET_STATUSES.forEach((status) => {
        const current = currentCounts[status] ?? 0;
        const previous = previousCounts[status] ?? 0;

        totalCurrent += current;
        totalPrevious += previous;

        payload[status] = current;
        payload[`${status}_change`] = roundToTwo(calcTrend(current, previous));
        statusBreakdown.push({ status, count: current });
      });

      payload.total = totalCurrent;
      payload.total_change = roundToTwo(calcTrend(totalCurrent, totalPrevious));
      payload.statusBreakdown = statusBreakdown;

      payload.priorityBreakdown = priorityAgg.map((item) => ({
        priority: item._id ?? "unknown",
        count: item.count,
      }));

      payload.tickets = ticketDocs.map((ticket: any) => ({
        id: ticket._id?.toString?.() ?? ticket._id,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        tags: Array.isArray(ticket.tags) ? ticket.tags : [],
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        assignee: ticket.assignee
          ? {
              id: ticket.assignee._id?.toString?.() ?? ticket.assignee._id,
              name: ticket.assignee.name ?? null,
              email: ticket.assignee.email ?? null,
            }
          : null,
        requester: ticket.requester
          ? {
              id:
                ticket.requester._id?.toString?.() ??
                ticket.requester._id ??
                "",
              name:
                ticket.requester.fullName ??
                ticket.requester.name ??
                ticket.requester?.email ??
                null,
              email: ticket.requester.email ?? null,
            }
          : null,
      }));

      return res.status(200).json({
        statusCode: 200,
        success: true,
        message: "Customer support snapshot generated successfully",
        data: payload,
        ...payload,
      });
    } catch (error) {
      next(error);
    }
  }
}
