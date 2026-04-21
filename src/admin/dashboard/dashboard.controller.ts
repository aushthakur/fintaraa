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
import type {
  AmountSeriesPoint,
  DashboardOverviewResponse,
  TimeSeriesPoint,
} from "./dashboard.types";
import type { AdvancedDashboardMetrics } from "./dashboardAdvanced.types";
import {
  buildDateRangeInTimeZone,
  formatDateInTimeZone,
  DEFAULT_QUERY_TIMEZONE,
} from "../../utils/helper";

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

const nextDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
};

const normalizeStatusFilter = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "all") return null;
  return normalized;
};

const buildStatusMatch = (
  start: Date,
  end: Date,
  statusValue?: string | null,
) => {
  const match: Record<string, any> = {
    createdAt: { $gte: start, $lte: end },
  };

  if (statusValue) {
    match.status = statusValue;
  }

  return match;
};

const toAmountMap = (rows: Array<{ _id: any; amount: number }>) =>
  (rows || []).reduce<Record<string, number>>((acc, r) => {
    if (r?._id) acc[String(r._id)] = r.amount ?? 0;
    return acc;
  }, {});

const eachDayKey = (start: Date, end: Date, timeZone: string) => {
  const days: string[] = [];
  let cur = formatDateInTimeZone(start, timeZone);
  const last = formatDateInTimeZone(end, timeZone);
  while (cur <= last) {
    days.push(cur);
    cur = nextDateKey(cur);
  }
  return days;
};

export class DashboardController {
  static async getOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, timezone, loanStatus, insuranceStatus, status } =
        req.query;
      const timeZone =
        typeof timezone === "string" && timezone.trim()
          ? timezone.trim()
          : DEFAULT_QUERY_TIMEZONE;
      const loanStatusFilter = normalizeStatusFilter(
        typeof loanStatus === "string" ? loanStatus : status,
      );
      const insuranceStatusFilter = normalizeStatusFilter(
        typeof insuranceStatus === "string" ? insuranceStatus : status,
      );
      const { start, end } = buildDateRangeInTimeZone(
        startDate,
        endDate,
        30,
        timeZone,
      );

      const startTs = start.getTime();
      const endTs = end.getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
        return res.status(400).json({
          success: false,
          message: "Invalid startDate/endDate",
        });
      }

      const dateKeys = eachDayKey(start, end, timeZone);
      const loanMatch = buildStatusMatch(start, end, loanStatusFilter);
      const insuranceMatch = buildStatusMatch(start, end, insuranceStatusFilter);

      const loanAmountExpr = { $ifNull: ["$loanAmount", 0] };
      const insuranceAmountExpr = {
        $ifNull: [
          "$policyDetails.sumInsured",
          {
            $ifNull: [
              "$policyDetails.sumAssured",
              { $ifNull: ["$annualIncome", 0] },
            ],
          },
        ],
      };

      const [
        usersAgg,
        loanAgg,
        insuranceAgg,
        loanAmountAgg,
        insuranceAmountAgg,
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
                    timezone: timeZone,
                  },
                },
                count: { $sum: 1 },
              },
          },
        ]),
        LoanQuery.aggregate([
          {
            $match: loanMatch,
          },
          {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: timeZone,
                  },
                },
                count: { $sum: 1 },
              },
          },
        ]),
        InsuranceQuery.aggregate([
          {
            $match: insuranceMatch,
          },
          {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: timeZone,
                  },
                },
                count: { $sum: 1 },
              },
          },
        ]),
        LoanQuery.aggregate([
          { $match: loanMatch },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                  timezone: timeZone,
                },
              },
              amount: { $sum: loanAmountExpr as any },
            },
          },
        ]),
        InsuranceQuery.aggregate([
          { $match: insuranceMatch },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                  timezone: timeZone,
                },
              },
              amount: { $sum: insuranceAmountExpr as any },
            },
          },
        ]),
        User.find({})
          .select("name email mobile status createdAt")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        LoanQuery.find(loanMatch)
          .select(
            "firstName lastName email mobile loanAmount loanType status customerId createdAt leadBy dataSource updatedByName"
          )
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        InsuranceQuery.find(insuranceMatch)
          .select(
            "firstName lastName email mobile typeOfInsurance status customerId annualIncome policyDetails createdAt"
          )
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),

        // breakdowns
        LoanQuery.aggregate([
          { $match: loanMatch },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        LoanQuery.aggregate([
          { $match: loanMatch },
          { $group: { _id: "$loanType", count: { $sum: 1 } } },
        ]),
        InsuranceQuery.aggregate([
          { $match: insuranceMatch },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        InsuranceQuery.aggregate([
          { $match: insuranceMatch },
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

      const loanAmountMap = toAmountMap(loanAmountAgg as any);
      const insuranceAmountMap = toAmountMap(insuranceAmountAgg as any);

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

      const seriesLoanAmounts: AmountSeriesPoint[] = dateKeys.map((date) => ({
        date,
        amount: loanAmountMap[date] ?? 0,
      }));

      const seriesInsuranceAmounts: AmountSeriesPoint[] = dateKeys.map((date) => ({
        date,
        amount: insuranceAmountMap[date] ?? 0,
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
          timezone: timeZone,
        },
        graphs: {
          newUsers: seriesUsers,
          loanApplications: seriesLoans,
          insuranceQueries: seriesInsurance,
          loanAmounts: seriesLoanAmounts,
          insuranceAmounts: seriesInsuranceAmounts,
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
            fileStatus: l.fileStatus || l.status,
            dataSource: l.dataSource || "",
            leadBy: l.leadBy || "",
            updatedByName: l.updatedByName || "",
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
            annualIncome: i.annualIncome,
            applicationAmount:
              i?.policyDetails?.sumInsured ??
              i?.policyDetails?.sumAssured ??
              i?.annualIncome ??
              0,
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

      const { start, end } = buildDateRangeInTimeZone(
        startDate,
        endDate,
        8,
        DEFAULT_QUERY_TIMEZONE,
      );

      if (start > end) {
        const temp = new Date(start);
        start.setTime(end.getTime());
        end.setTime(temp.getTime());
      }

      const duration = Math.max(end.getTime() - start.getTime(), 0);
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - duration);

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
