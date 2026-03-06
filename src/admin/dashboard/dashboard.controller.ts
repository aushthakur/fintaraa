import { Types } from "mongoose";
import Ticket from "../../modals/ticket.model";
import { Request, Response, NextFunction } from "express";
import { User } from "../../modals/user.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { InsuranceQuery } from "../../modals/insurancequery.model";
import { Offer } from "../../modals/offer.model";
import { Knowledge } from "../../modals/knowledge.model";
import { Banker } from "../../modals/banker.model";
import { DocumentCatalog } from "../../modals/documentCatalog.model";
import { Contest } from "../../modals/contest.model";
import { BankProduct } from "../../modals/bankProduct.model";
import type { DashboardOverviewResponse, TimeSeriesPoint } from "./dashboard.types";
import type { AdvancedDashboardMetrics } from "./dashboardAdvanced.types";

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

const startOfDayUTC = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const endOfDayUTC = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
};

const eachDayUTC = (start: Date, end: Date) => {
  const days: Date[] = [];
  let cur = startOfDayUTC(start);
  const last = startOfDayUTC(end);
  while (cur.getTime() <= last.getTime()) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
};

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

export class DashboardController {
  static async getOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, timezone } = req.query;

      const now = new Date();
      const end = endOfDayUTC(
        typeof endDate === "string" && endDate.trim() ? new Date(endDate) : now
      );
      const startDefault = new Date(end);
      startDefault.setUTCDate(startDefault.getUTCDate() - 29);
      const start = startOfDayUTC(
        typeof startDate === "string" && startDate.trim()
          ? new Date(startDate)
          : startDefault
      );

      const startTs = start.getTime();
      const endTs = end.getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
        return res.status(400).json({
          success: false,
          message: "Invalid startDate/endDate",
        });
      }

      const days = eachDayUTC(start, end);
      const dateKeys = days.map(toISODate);

      const [
        usersAgg,
        loanAgg,
        insuranceAgg,
        topUsers,
        topLoans,
        topInsurance,
        // Advanced breakdowns + totals
        loansByStatusAgg,
        loansByTypeAgg,
        insuranceByStatusAgg,
        insuranceByTypeAgg,
        offersByStatusAgg,
        offersByCategoryAgg,
        offerApplicationsByStatusAgg,
        knowledgeByTypeAgg,
        knowledgeByStatusAgg,
        bankingPartnersByStatusAgg,
        documentLibraryByStatusAgg,
        contestsByStatusAgg,
        financialProductsByStatusAgg,
        totalsUsers,
        totalsLoans,
        totalsInsurance,
        totalsOffers,
        totalsKnowledge,
        totalsBankingPartners,
        totalsDocumentLibrary,
        totalsContests,
        totalsFinancialProducts,
        totalsOfferApplications,
      ] = await Promise.all([
        User.aggregate([
          {
            $match: {
              createdAt: { $gte: start, $lte: end },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                },
              },
              count: { $sum: 1 },
            },
          },
        ]),
        LoanQuery.aggregate([
          {
            $match: {
              createdAt: { $gte: start, $lte: end },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                },
              },
              count: { $sum: 1 },
            },
          },
        ]),
        InsuranceQuery.aggregate([
          {
            $match: {
              createdAt: { $gte: start, $lte: end },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                },
              },
              count: { $sum: 1 },
            },
          },
        ]),
        User.find({})
          .select("name email mobile status createdAt")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        LoanQuery.find({})
          .select(
            "firstName lastName email mobile loanAmount loanType status customerId createdAt"
          )
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        InsuranceQuery.find({})
          .select(
            "firstName lastName email mobile typeOfInsurance status customerId createdAt"
          )
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),

        // breakdowns
        LoanQuery.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        LoanQuery.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$loanType", count: { $sum: 1 } } },
        ]),
        InsuranceQuery.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        InsuranceQuery.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$typeOfInsurance", count: { $sum: 1 } } },
        ]),
        Offer.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Offer.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: { $ifNull: ["$productCategory", "unknown"] }, count: { $sum: 1 } } },
        ]),
        Offer.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $unwind: { path: "$applications", preserveNullAndEmptyArrays: false } },
          { $group: { _id: "$applications.status", count: { $sum: 1 } } },
        ]),
        Knowledge.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$type", count: { $sum: 1 } } },
        ]),
        Knowledge.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          {
            $project: {
              status: {
                $cond: [{ $ifNull: ["$isActive", false] }, "active", "inactive"],
              },
            },
          },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Banker.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        DocumentCatalog.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          {
            $project: {
              status: {
                $cond: [{ $ifNull: ["$isActive", false] }, "active", "inactive"],
              },
            },
          },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Contest.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        BankProduct.aggregate([
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),

        // totals
        User.countDocuments({}),
        LoanQuery.countDocuments({}),
        InsuranceQuery.countDocuments({}),
        Offer.countDocuments({}),
        Knowledge.countDocuments({}),
        Banker.countDocuments({}),
        DocumentCatalog.countDocuments({}),
        Contest.countDocuments({}),
        BankProduct.countDocuments({}),
        Offer.aggregate([
          { $project: { apps: { $size: { $ifNull: ["$applications", []] } } } },
          { $group: { _id: null, total: { $sum: "$apps" } } },
        ]),
      ]);

      const usersMap = usersAgg.reduce<Record<string, number>>((acc, r) => {
        if (r?._id) acc[String(r._id)] = r.count ?? 0;
        return acc;
      }, {});

      const loansMap = loanAgg.reduce<Record<string, number>>((acc, r) => {
        if (r?._id) acc[String(r._id)] = r.count ?? 0;
        return acc;
      }, {});

      const insuranceMap = insuranceAgg.reduce<Record<string, number>>((acc, r) => {
        if (r?._id) acc[String(r._id)] = r.count ?? 0;
        return acc;
      }, {});

      const seriesUsers: TimeSeriesPoint[] = dateKeys.map((date) => ({
        date,
        count: usersMap[date] ?? 0,
      }));

      const seriesLoans: TimeSeriesPoint[] = dateKeys.map((date) => ({
        date,
        count: loansMap[date] ?? 0,
      }));

      const seriesInsurance: TimeSeriesPoint[] = dateKeys.map((date) => ({
        date,
        count: insuranceMap[date] ?? 0,
      }));

      const toBreakdownMap = (rows: Array<{ _id: any; count: number }>) =>
        (rows || []).reduce<Record<string, number>>((acc, r) => {
          if (r?._id != null) acc[String(r._id)] = r.count ?? 0;
          return acc;
        }, {});

      const totalsOfferApps =
        Array.isArray(totalsOfferApplications) && totalsOfferApplications[0]?.total
          ? Number(totalsOfferApplications[0].total)
          : 0;

      const advanced: AdvancedDashboardMetrics = {
        totals: {
          users: Number(totalsUsers) || 0,
          loanQueries: Number(totalsLoans) || 0,
          insuranceQueries: Number(totalsInsurance) || 0,
          offers: Number(totalsOffers) || 0,
          offerApplications: totalsOfferApps,
          knowledgeItems: Number(totalsKnowledge) || 0,
          bankingPartners: Number(totalsBankingPartners) || 0,
          documentLibraryItems: Number(totalsDocumentLibrary) || 0,
          contests: Number(totalsContests) || 0,
          financialProducts: Number(totalsFinancialProducts) || 0,
        },
        breakdowns: {
          loansByStatus: toBreakdownMap(loansByStatusAgg as any),
          loansByType: toBreakdownMap(loansByTypeAgg as any),
          insuranceByStatus: toBreakdownMap(insuranceByStatusAgg as any),
          insuranceByType: toBreakdownMap(insuranceByTypeAgg as any),
          offersByStatus: toBreakdownMap(offersByStatusAgg as any),
          offersByCategory: toBreakdownMap(offersByCategoryAgg as any),
          offerApplicationsByStatus: toBreakdownMap(
            offerApplicationsByStatusAgg as any
          ),
          knowledgeByType: toBreakdownMap(knowledgeByTypeAgg as any),
          knowledgeByStatus: toBreakdownMap(knowledgeByStatusAgg as any),
          bankingPartnersByStatus: toBreakdownMap(
            bankingPartnersByStatusAgg as any
          ),
          documentLibraryByStatus: toBreakdownMap(
            documentLibraryByStatusAgg as any
          ),
          contestsByStatus: toBreakdownMap(contestsByStatusAgg as any),
          financialProductsByStatus: toBreakdownMap(
            financialProductsByStatusAgg as any
          ),
        },
        seriesByStatus: {
          loans: {},
          insurance: {},
        },
      };

      const payload: DashboardOverviewResponse = {
        range: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          timezone: typeof timezone === "string" ? timezone : "UTC",
        },
        graphs: {
          newUsers: seriesUsers,
          loanApplications: seriesLoans,
          insuranceQueries: seriesInsurance,
        },
        advanced,
        top5: {
          newUsers: topUsers.map((u: any) => ({
            id: u._id?.toString?.() ?? String(u._id),
            name: u.name,
            email: u.email,
            mobile: u.mobile,
            createdAt: u.createdAt,
            status: u.status,
          })),
          loanApplications: topLoans.map((l: any) => ({
            id: l._id?.toString?.() ?? String(l._id),
            customerId: l.customerId?.toString?.() ?? String(l.customerId),
            name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
            email: l.email,
            mobile: l.mobile,
            loanType: l.loanType,
            loanAmount: l.loanAmount,
            status: l.status,
            createdAt: l.createdAt,
          })),
          insuranceApplications: topInsurance.map((i: any) => ({
            id: i._id?.toString?.() ?? String(i._id),
            customerId: i.customerId?.toString?.() ?? String(i.customerId),
            name: `${i.firstName ?? ""} ${i.lastName ?? ""}`.trim(),
            email: i.email,
            mobile: i.mobile,
            typeOfInsurance: i.typeOfInsurance,
            status: i.status,
            createdAt: i.createdAt,
          })),
        },
      };

      return res.status(200).json({
        success: true,
        message: "Dashboard overview",
        data: payload,
      });
    } catch (error) {
      next(error);
    }
  }

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
