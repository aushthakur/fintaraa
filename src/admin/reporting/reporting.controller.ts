import mongoose, { Types } from "mongoose";
import { Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { LoanQuery, LoanType } from "../../modals/loanquery.model";
import {
  ApplicationStatus,
  InsuranceQuery,
  InsuranceType,
} from "../../modals/insurancequery.model";
import Lead from "../../modals/lead.model";
import { User, RegistrationSource } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import { AgencyCommissionTransaction } from "../../modals/agencyCommissionTransaction.model";
import {
  Partner,
  PartnerType,
} from "../../modals/partner.model";
import {
  PartnerAssignment,
  PartnerAssignmentStatus,
} from "../../modals/partnerAssignment.model";
import { BankProduct } from "../../modals/bankProduct.model";
import { EngagementEvent } from "../../modals/engagementEvent.model";
import {
  DEFAULT_QUERY_TIMEZONE,
  parseDateInTimeZone,
} from "../../utils/helper";

type ReportKey =
  | "loan-applications"
  | "insurance-applications"
  | "credit-card-applications"
  | "lead-sources"
  | "dsa-performance"
  | "partner-performance"
  | "revenue"
  | "user-registrations"
  | "website-traffic";

type ColumnFormat = "text" | "date" | "number" | "currency" | "percentage";

type ReportColumn = {
  key: string;
  label: string;
  format?: ColumnFormat;
};

type SummaryMetric = {
  label: string;
  value: number | string;
  format?: ColumnFormat;
};

type ReportResult = {
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  summary: SummaryMetric[];
  note?: string;
  truncated?: boolean;
};

const REPORT_ROW_LIMIT = 10_000;

const reportKeys = new Set<ReportKey>([
  "loan-applications",
  "insurance-applications",
  "credit-card-applications",
  "lead-sources",
  "dsa-performance",
  "partner-performance",
  "revenue",
  "user-registrations",
  "website-traffic",
]);

const approvedStatuses = [
  ApplicationStatus.APPROVED,
  ApplicationStatus.LOGIN_APPROVED,
  ApplicationStatus.SANCTIONED,
  ApplicationStatus.APPROVED_WITH_CONDITIONS,
  ApplicationStatus.DISBURSED,
  ApplicationStatus.DISBURSED_PARTIAL_FULL,
  ApplicationStatus.COMPLETED_SUCCESS,
];

const rejectedStatuses = [
  ApplicationStatus.REJECTED,
  ApplicationStatus.REJECTED_BY_BANK,
  ApplicationStatus.NOT_ELIGIBLE,
  ApplicationStatus.DROPPED_LOST,
  ApplicationStatus.CANCELLED,
  ApplicationStatus.CANCELLED_BY_CUSTOMER,
];

const clean = (value: unknown, max = 200) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exactRegex = (value: unknown) =>
  new RegExp(`^${escapeRegex(clean(value))}$`, "i");

const optionalObjectId = (value: unknown, label: string) => {
  if (!value) return undefined;
  if (!mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${label} is invalid`);
  }
  return new Types.ObjectId(String(value));
};

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
) => {
  if (!value) return undefined;
  const parsed = clean(value) as T;
  if (!values.includes(parsed)) {
    throw new ApiError(400, `${label} must be one of: ${values.join(", ")}`);
  }
  return parsed;
};

const dateRange = (query: Request["query"]) => {
  const startDate = query.startDate
    ? parseDateInTimeZone(
        clean(query.startDate, 20),
        "start",
        DEFAULT_QUERY_TIMEZONE,
      )
    : null;
  const endDate = query.endDate
    ? parseDateInTimeZone(
        clean(query.endDate, 20),
        "end",
        DEFAULT_QUERY_TIMEZONE,
      )
    : null;
  if (query.startDate && !startDate) throw new ApiError(400, "startDate is invalid");
  if (query.endDate && !endDate) throw new ApiError(400, "endDate is invalid");
  if (startDate && endDate && startDate > endDate) {
    throw new ApiError(400, "startDate cannot be after endDate");
  }
  const range = {
    ...(startDate ? { $gte: startDate } : {}),
    ...(endDate ? { $lte: endDate } : {}),
  };
  return Object.keys(range).length ? range : undefined;
};

const roundedRate = (numerator: number, denominator: number) =>
  denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;

const titleCase = (value: unknown) =>
  clean(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const partnerLookupStages = [
  {
    $lookup: {
      from: "partnerassignments",
      let: { applicationId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$application", "$$applicationId"] },
                { $ne: ["$status", PartnerAssignmentStatus.SUGGESTED] },
              ],
            },
          },
        },
      ],
      as: "partnerAssignments",
    },
  },
  {
    $lookup: {
      from: "partners",
      localField: "partnerAssignments.partner",
      foreignField: "_id",
      as: "partnerRows",
    },
  },
  {
    $addFields: {
      partnerNames: {
        $map: { input: "$partnerRows", as: "partner", in: "$$partner.name" },
      },
    },
  },
];

const applicationSummary = (rows: Array<Record<string, any>>) => {
  const approved = rows.filter((row) => approvedStatuses.includes(row.status)).length;
  const rejected = rows.filter((row) => rejectedStatuses.includes(row.status)).length;
  return [
    { label: "Applications", value: rows.length, format: "number" as const },
    { label: "Approved", value: approved, format: "number" as const },
    { label: "Rejected", value: rejected, format: "number" as const },
    {
      label: "Conversion rate",
      value: roundedRate(approved, rows.length),
      format: "percentage" as const,
    },
  ];
};

const loanApplicationsReport = async (req: Request): Promise<ReportResult> => {
  const match: Record<string, any> = { isDeleted: { $ne: true } };
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  const loanType = enumValue(req.query.loanType, Object.values(LoanType), "loanType");
  const status = enumValue(
    req.query.status,
    Object.values(ApplicationStatus),
    "status",
  );
  if (loanType) match.loanType = loanType;
  else match.loanType = { $ne: LoanType.CREDIT_CARD };
  if (status) match.status = status;
  if (req.query.city) match.city = exactRegex(req.query.city);
  const partnerId = optionalObjectId(req.query.partnerId, "partnerId");

  const pipeline: any[] = [
    { $match: match },
    ...partnerLookupStages,
    ...(partnerId
      ? [{ $match: { "partnerAssignments.partner": partnerId } }]
      : []),
    { $sort: { createdAt: -1 } },
    { $limit: REPORT_ROW_LIMIT + 1 },
    {
      $project: {
        _id: 1,
        applicationDate: "$createdAt",
        applicationId: { $ifNull: ["$loanId", { $toString: "$_id" }] },
        loanType: 1,
        applicant: {
          $trim: { input: { $concat: ["$firstName", " ", "$lastName"] } },
        },
        city: 1,
        status: 1,
        partner: {
          $cond: [
            { $gt: [{ $size: "$partnerNames" }, 0] },
            { $reduce: { input: "$partnerNames", initialValue: "", in: { $cond: [{ $eq: ["$$value", ""] }, "$$this", { $concat: ["$$value", ", ", "$$this"] }] } } },
            "Unassigned",
          ],
        },
        amount: { $ifNull: ["$loanAmount", 0] },
      },
    },
  ];
  const fetched = (await LoanQuery.aggregate(pipeline)) as Array<Record<string, any>>;
  const truncated = fetched.length > REPORT_ROW_LIMIT;
  const rows = fetched.slice(0, REPORT_ROW_LIMIT);
  return {
    title: "Loan Application Report",
    description: "Loan applications by product, status, city, partner and date range.",
    columns: [
      { key: "applicationDate", label: "Applied on", format: "date" },
      { key: "applicationId", label: "Application ID" },
      { key: "loanType", label: "Loan type" },
      { key: "applicant", label: "Applicant" },
      { key: "city", label: "City" },
      { key: "status", label: "Status" },
      { key: "partner", label: "Partner" },
      { key: "amount", label: "Loan amount", format: "currency" },
    ],
    rows,
    summary: applicationSummary(rows),
    truncated,
  };
};

const insuranceApplicationsReport = async (
  req: Request,
): Promise<ReportResult> => {
  const match: Record<string, any> = { isDeleted: { $ne: true } };
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  const insuranceType = enumValue(
    req.query.insuranceType,
    Object.values(InsuranceType),
    "insuranceType",
  );
  const status = enumValue(
    req.query.status,
    Object.values(ApplicationStatus),
    "status",
  );
  if (insuranceType) match.typeOfInsurance = insuranceType;
  if (status) match.status = status;
  const insurerId = optionalObjectId(req.query.insurerId, "insurerId");

  const pipeline: any[] = [
    { $match: match },
    ...partnerLookupStages,
    ...(insurerId
      ? [{ $match: { "partnerAssignments.partner": insurerId } }]
      : []),
    { $sort: { createdAt: -1 } },
    { $limit: REPORT_ROW_LIMIT + 1 },
    {
      $project: {
        _id: 1,
        applicationDate: "$createdAt",
        applicationId: { $ifNull: ["$insuranceId", { $toString: "$_id" }] },
        insuranceType: "$typeOfInsurance",
        applicant: {
          $trim: { input: { $concat: ["$firstName", " ", "$lastName"] } },
        },
        city: 1,
        status: 1,
        insurer: {
          $cond: [
            { $gt: [{ $size: "$partnerNames" }, 0] },
            { $reduce: { input: "$partnerNames", initialValue: "", in: { $cond: [{ $eq: ["$$value", ""] }, "$$this", { $concat: ["$$value", ", ", "$$this"] }] } } },
            "Unassigned",
          ],
        },
      },
    },
  ];
  const fetched = (await InsuranceQuery.aggregate(pipeline)) as Array<Record<string, any>>;
  const truncated = fetched.length > REPORT_ROW_LIMIT;
  const rows = fetched.slice(0, REPORT_ROW_LIMIT);
  return {
    title: "Insurance Application Report",
    description: "Insurance applications by type, insurer, status and date range.",
    columns: [
      { key: "applicationDate", label: "Applied on", format: "date" },
      { key: "applicationId", label: "Application ID" },
      { key: "insuranceType", label: "Insurance type" },
      { key: "applicant", label: "Applicant" },
      { key: "city", label: "City" },
      { key: "status", label: "Status" },
      { key: "insurer", label: "Insurer" },
    ],
    rows,
    summary: applicationSummary(rows),
    truncated,
  };
};

const creditCardApplicationsReport = async (
  req: Request,
): Promise<ReportResult> => {
  const match: Record<string, any> = {
    isDeleted: { $ne: true },
    loanType: LoanType.CREDIT_CARD,
  };
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  const status = enumValue(
    req.query.status,
    Object.values(ApplicationStatus),
    "status",
  );
  if (status) match.status = status;

  const cardType = clean(req.query.cardType);
  if (cardType) {
    match.$or = [
      { "policyDetails.cardType": exactRegex(cardType) },
      { "policyDetails.cardCategory": exactRegex(cardType) },
      { "policyDetails.productName": exactRegex(cardType) },
    ];
  }
  const bank = clean(req.query.bank);
  const pipeline: any[] = [
    { $match: match },
    ...partnerLookupStages,
    ...(bank
      ? [
          {
            $match: {
              $or: [
                { bankName: exactRegex(bank) },
                { "policyDetails.bankName": exactRegex(bank) },
                { partnerNames: exactRegex(bank) },
              ],
            },
          },
        ]
      : []),
    { $sort: { createdAt: -1 } },
    { $limit: REPORT_ROW_LIMIT + 1 },
    {
      $project: {
        _id: 1,
        applicationDate: "$createdAt",
        applicationId: { $ifNull: ["$loanId", { $toString: "$_id" }] },
        applicant: {
          $trim: { input: { $concat: ["$firstName", " ", "$lastName"] } },
        },
        cardType: {
          $ifNull: [
            "$policyDetails.cardType",
            {
              $ifNull: [
                "$policyDetails.cardCategory",
                { $ifNull: ["$policyDetails.productName", "Not captured"] },
              ],
            },
          ],
        },
        bank: {
          $ifNull: [
            "$policyDetails.bankName",
            {
              $ifNull: [
                "$bankName",
                { $ifNull: [{ $arrayElemAt: ["$partnerNames", 0] }, "Unassigned"] },
              ],
            },
          ],
        },
        city: 1,
        status: 1,
      },
    },
  ];
  const fetched = (await LoanQuery.aggregate(pipeline)) as Array<Record<string, any>>;
  const truncated = fetched.length > REPORT_ROW_LIMIT;
  const rows = fetched.slice(0, REPORT_ROW_LIMIT);
  return {
    title: "Credit Card Application Report",
    description: "Credit card applications by card type, bank, status and date range.",
    columns: [
      { key: "applicationDate", label: "Applied on", format: "date" },
      { key: "applicationId", label: "Application ID" },
      { key: "applicant", label: "Applicant" },
      { key: "cardType", label: "Card type" },
      { key: "bank", label: "Bank" },
      { key: "city", label: "City" },
      { key: "status", label: "Status" },
    ],
    rows,
    summary: applicationSummary(rows),
    truncated,
  };
};

const leadSourceExpression = {
  $let: {
    vars: {
      sourceText: {
        $toLower: {
          $concat: [
            { $ifNull: ["$capturedFrom.platform", ""] },
            " ",
            { $ifNull: ["$capturedFrom.channel", ""] },
            " ",
            { $ifNull: ["$utm.source", ""] },
            " ",
            { $ifNull: ["$utm.medium", ""] },
          ],
        },
      },
    },
    in: {
      $switch: {
        branches: [
          {
            case: { $regexMatch: { input: "$$sourceText", regex: /missed[ _-]?call/ } },
            then: "missed_call",
          },
          {
            case: { $regexMatch: { input: "$$sourceText", regex: /whatsapp|wa_click/ } },
            then: "whatsapp",
          },
          {
            case: { $regexMatch: { input: "$$sourceText", regex: /affiliate|referral|refer/ } },
            then: "referral",
          },
          {
            case: { $regexMatch: { input: "$$sourceText", regex: /meta_ads|google_ads|paid|cpc|ppc|display/ } },
            then: "paid",
          },
          {
            case: { $regexMatch: { input: "$$sourceText", regex: /seo|organic|website|landing_page/ } },
            then: "seo",
          },
        ],
        default: "other",
      },
    },
  },
};

const leadSourcesReport = async (req: Request): Promise<ReportResult> => {
  const match: Record<string, any> = {};
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  const source = enumValue(
    req.query.source,
    ["seo", "paid", "referral", "whatsapp", "missed_call", "other"],
    "source",
  );
  const pipeline: any[] = [
    { $match: match },
    { $addFields: { reportSource: leadSourceExpression } },
    ...(source ? [{ $match: { reportSource: source } }] : []),
    {
      $group: {
        _id: "$reportSource",
        totalLeads: { $sum: 1 },
        converted: {
          $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] },
        },
      },
    },
    { $sort: { totalLeads: -1 } },
  ];
  const found = (await Lead.aggregate(pipeline)) as Array<Record<string, any>>;
  const sourceKeys = source
    ? [source]
    : ["seo", "paid", "referral", "whatsapp", "missed_call", "other"];
  const bySource = new Map(found.map((row) => [row._id, row]));
  const rows = sourceKeys.map((key) => {
    const row = bySource.get(key) || {};
    const totalLeads = Number(row.totalLeads || 0);
    const converted = Number(row.converted || 0);
    return {
      source: titleCase(key),
      totalLeads,
      converted,
      conversionRate: roundedRate(converted, totalLeads),
    };
  });
  const totals = rows.reduce(
    (result, row) => ({
      leads: result.leads + row.totalLeads,
      converted: result.converted + row.converted,
    }),
    { leads: 0, converted: 0 },
  );
  return {
    title: "Lead Source Report",
    description: "Lead acquisition and conversion split by normalized marketing source.",
    columns: [
      { key: "source", label: "Source" },
      { key: "totalLeads", label: "Leads", format: "number" },
      { key: "converted", label: "Converted", format: "number" },
      { key: "conversionRate", label: "Conversion rate", format: "percentage" },
    ],
    rows,
    summary: [
      { label: "Leads", value: totals.leads, format: "number" },
      { label: "Converted", value: totals.converted, format: "number" },
      {
        label: "Conversion rate",
        value: roundedRate(totals.converted, totals.leads),
        format: "percentage",
      },
      { label: "Sources", value: rows.filter((row) => row.totalLeads > 0).length, format: "number" },
    ],
  };
};

const applicationPerformanceByAgency = async (
  model: typeof LoanQuery | typeof InsuranceQuery,
  match: Record<string, any>,
) =>
  model.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$ownerAgency",
        applications: { $sum: 1 },
        approved: {
          $sum: { $cond: [{ $in: ["$status", approvedStatuses] }, 1, 0] },
        },
      },
    },
  ] as any[]);

const dsaPerformanceReport = async (req: Request): Promise<ReportResult> => {
  const dsaId = optionalObjectId(req.query.dsaId, "dsaId");
  const range = dateRange(req.query);
  const applicationMatch: Record<string, any> = {
    ownerAgency: dsaId || { $exists: true, $ne: null },
    isDeleted: { $ne: true },
    ...(range ? { createdAt: range } : {}),
  };
  const commissionMatch: Record<string, any> = {
    isCanonical: { $ne: false },
    earningStatus: { $in: ["earned", "paid"] },
    ...(dsaId ? { ownerAgency: dsaId } : {}),
    ...(range ? { createdAt: range } : {}),
  };
  const [loanRows, insuranceRows, commissionRows] = await Promise.all([
    applicationPerformanceByAgency(LoanQuery, applicationMatch),
    applicationPerformanceByAgency(InsuranceQuery, applicationMatch),
    AgencyCommissionTransaction.aggregate([
      { $match: commissionMatch },
      {
        $group: {
          _id: "$ownerAgency",
          commission: { $sum: "$commissionAmount" },
          paidCommission: {
            $sum: {
              $cond: [
                { $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] },
                "$paidAmount",
                { $cond: [{ $eq: ["$earningStatus", "paid"] }, "$commissionAmount", 0] },
              ],
            },
          },
        },
      },
    ]),
  ]);
  const metrics = new Map<string, { applications: number; approved: number; commission: number; paidCommission: number }>();
  const mergeApplications = (items: any[]) => {
    items.forEach((item) => {
      const key = String(item._id);
      const current = metrics.get(key) || { applications: 0, approved: 0, commission: 0, paidCommission: 0 };
      current.applications += Number(item.applications || 0);
      current.approved += Number(item.approved || 0);
      metrics.set(key, current);
    });
  };
  mergeApplications(loanRows);
  mergeApplications(insuranceRows);
  commissionRows.forEach((item: any) => {
    const key = String(item._id);
    const current = metrics.get(key) || { applications: 0, approved: 0, commission: 0, paidCommission: 0 };
    current.commission = Number(item.commission || 0);
    current.paidCommission = Number(item.paidCommission || 0);
    metrics.set(key, current);
  });
  const agencyIds = Array.from(metrics.keys()).map((id) => new Types.ObjectId(id));
  const agencies = await Agency.find({
    role: "agency",
    ...(dsaId ? { _id: dsaId } : { _id: { $in: agencyIds } }),
  })
    .select("name businessName agencyId referralCode")
    .lean();
  const rows = agencies
    .map((agency: any) => {
      const metric = metrics.get(String(agency._id)) || {
        applications: 0,
        approved: 0,
        commission: 0,
        paidCommission: 0,
      };
      return {
        dsa: agency.businessName || agency.name,
        agencyId: agency.agencyId || agency.referralCode || String(agency._id),
        applications: metric.applications,
        approved: metric.approved,
        approvalRate: roundedRate(metric.approved, metric.applications),
        commissionEarned: metric.commission,
        commissionPaid: metric.paidCommission,
      };
    })
    .sort((first, second) => second.commissionEarned - first.commissionEarned);
  const totals = rows.reduce(
    (result, row) => ({
      applications: result.applications + row.applications,
      approved: result.approved + row.approved,
      commission: result.commission + row.commissionEarned,
    }),
    { applications: 0, approved: 0, commission: 0 },
  );
  return {
    title: "DSA Performance Report",
    description: "Loan and insurance application output, approval rate and earned commission per DSA.",
    columns: [
      { key: "dsa", label: "DSA" },
      { key: "agencyId", label: "Agency ID" },
      { key: "applications", label: "Applications", format: "number" },
      { key: "approved", label: "Approved", format: "number" },
      { key: "approvalRate", label: "Approval rate", format: "percentage" },
      { key: "commissionEarned", label: "Commission earned", format: "currency" },
      { key: "commissionPaid", label: "Commission paid", format: "currency" },
    ],
    rows,
    summary: [
      { label: "Applications", value: totals.applications, format: "number" },
      { label: "Approved", value: totals.approved, format: "number" },
      { label: "Approval rate", value: roundedRate(totals.approved, totals.applications), format: "percentage" },
      { label: "Commission earned", value: totals.commission, format: "currency" },
    ],
  };
};

const partnerPerformanceReport = async (req: Request): Promise<ReportResult> => {
  const partnerId = optionalObjectId(req.query.partnerId, "partnerId");
  const partnerType = enumValue(
    req.query.partnerType,
    Object.values(PartnerType),
    "partnerType",
  );
  const range = dateRange(req.query);
  const assignmentMatch: Record<string, any> = {
    ...(partnerId ? { partner: partnerId } : {}),
    ...(range ? { assignedAt: range } : {}),
  };
  const [partners, metrics] = await Promise.all([
    Partner.find({
      isDeleted: false,
      ...(partnerId ? { _id: partnerId } : {}),
      ...(partnerType ? { type: partnerType } : {}),
    })
      .select("name type status")
      .lean(),
    PartnerAssignment.aggregate([
      { $match: assignmentMatch },
      {
        $group: {
          _id: "$partner",
          assigned: {
            $sum: {
              $cond: [
                { $ne: ["$status", PartnerAssignmentStatus.SUGGESTED] },
                1,
                0,
              ],
            },
          },
          approved: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    [
                      PartnerAssignmentStatus.APPROVED,
                      PartnerAssignmentStatus.DISBURSED,
                      PartnerAssignmentStatus.POLICY_ISSUED,
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
          rejected: {
            $sum: {
              $cond: [
                { $eq: ["$status", PartnerAssignmentStatus.REJECTED] },
                1,
                0,
              ],
            },
          },
          pending: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    [
                      PartnerAssignmentStatus.ASSIGNED,
                      PartnerAssignmentStatus.SENT,
                      PartnerAssignmentStatus.ACCEPTED,
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
          averageTurnaroundMs: {
            $avg: {
              $cond: [
                { $and: [{ $ne: ["$decisionAt", null] }, { $ne: ["$assignedAt", null] }] },
                { $subtract: ["$decisionAt", "$assignedAt"] },
                null,
              ],
            },
          },
          decisionCount: { $sum: { $cond: [{ $ne: ["$decisionAt", null] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byPartner = new Map(metrics.map((row: any) => [String(row._id), row]));
  const rows = partners.map((partner: any) => {
    const metric: any = byPartner.get(String(partner._id)) || {};
    const assigned = Number(metric.assigned || 0);
    const approved = Number(metric.approved || 0);
    return {
      partner: partner.name,
      partnerType: partner.type,
      assigned,
      approved,
      rejected: Number(metric.rejected || 0),
      pending: Number(metric.pending || 0),
      conversionRate: roundedRate(approved, assigned),
      averageTatHours: Number((Number(metric.averageTurnaroundMs || 0) / 3_600_000).toFixed(2)),
      decisionCount: Number(metric.decisionCount || 0),
    };
  });
  const totals = rows.reduce(
    (result, row) => ({
      assigned: result.assigned + row.assigned,
      approved: result.approved + row.approved,
      rejected: result.rejected + row.rejected,
      decisionCount: result.decisionCount + row.decisionCount,
      tatTotal: result.tatTotal + row.averageTatHours * row.decisionCount,
    }),
    { assigned: 0, approved: 0, rejected: 0, decisionCount: 0, tatTotal: 0 },
  );
  return {
    title: "Partner Performance Report",
    description: "Assignment volume, outcomes, conversion and decision turnaround by partner.",
    columns: [
      { key: "partner", label: "Partner" },
      { key: "partnerType", label: "Type" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "approved", label: "Approved", format: "number" },
      { key: "rejected", label: "Rejected", format: "number" },
      { key: "pending", label: "Pending", format: "number" },
      { key: "conversionRate", label: "Conversion", format: "percentage" },
      { key: "averageTatHours", label: "Average TAT (hours)", format: "number" },
    ],
    rows,
    summary: [
      { label: "Assigned", value: totals.assigned, format: "number" },
      { label: "Approved", value: totals.approved, format: "number" },
      { label: "Conversion rate", value: roundedRate(totals.approved, totals.assigned), format: "percentage" },
      { label: "Average TAT", value: totals.decisionCount ? Number((totals.tatTotal / totals.decisionCount).toFixed(2)) : 0, format: "number" },
    ],
  };
};

const revenueReport = async (req: Request): Promise<ReportResult> => {
  const match: Record<string, any> = { isCanonical: { $ne: false } };
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  const earningStatus = enumValue(
    req.query.earningStatus,
    ["pending", "earned", "paid", "reversed", "clawback_required"],
    "earningStatus",
  );
  if (earningStatus) match.earningStatus = earningStatus;
  const productCategory = enumValue(
    req.query.productCategory,
    ["loan", "insurance", "credit_card"],
    "productCategory",
  );
  if (productCategory === "insurance") match.queryType = "insurance";
  if (productCategory === "credit_card") {
    match.queryType = "loan";
    match.loanType = LoanType.CREDIT_CARD;
  }
  if (productCategory === "loan") {
    match.queryType = "loan";
    match.loanType = { $ne: LoanType.CREDIT_CARD };
  }
  const partnerId = optionalObjectId(req.query.partnerId, "partnerId");
  const pipeline: any[] = [
    { $match: match },
    {
      $lookup: {
        from: "partnerassignments",
        let: { queryId: "$queryRef" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$application", "$$queryId"] },
                  { $ne: ["$status", PartnerAssignmentStatus.SUGGESTED] },
                ],
              },
            },
          },
        ],
        as: "assignments",
      },
    },
    ...(partnerId ? [{ $match: { "assignments.partner": partnerId } }] : []),
    {
      $lookup: {
        from: "partners",
        localField: "assignments.partner",
        foreignField: "_id",
        as: "partnerRows",
      },
    },
    {
      $addFields: {
        reportCategory: {
          $cond: [
            { $eq: ["$queryType", "insurance"] },
            "insurance",
            { $cond: [{ $eq: ["$loanType", LoanType.CREDIT_CARD] }, "credit_card", "loan"] },
          ],
        },
        reportProduct: {
          $ifNull: ["$productType", { $ifNull: ["$loanType", "$insuranceType"] }],
        },
        reportPartner: { $ifNull: [{ $arrayElemAt: ["$partnerRows.name", 0] }, "Unassigned"] },
      },
    },
    {
      $group: {
        _id: {
          date: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: DEFAULT_QUERY_TIMEZONE,
            },
          },
          category: "$reportCategory",
          product: "$reportProduct",
          partner: "$reportPartner",
        },
        transactions: { $sum: 1 },
        disbursedAmount: { $sum: { $ifNull: ["$disbursedAmount", 0] } },
        income: { $sum: { $ifNull: ["$commissionAmount", 0] } },
        paidAmount: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] },
              "$paidAmount",
              { $cond: [{ $eq: ["$earningStatus", "paid"] }, "$commissionAmount", 0] },
            ],
          },
        },
      },
    },
    { $sort: { "_id.date": -1, income: -1 } },
    { $limit: REPORT_ROW_LIMIT + 1 },
    {
      $project: {
        _id: 0,
        date: "$_id.date",
        productCategory: "$_id.category",
        productType: "$_id.product",
        partner: "$_id.partner",
        transactions: 1,
        disbursedAmount: 1,
        income: 1,
        paidAmount: 1,
      },
    },
  ];
  const fetched = (await AgencyCommissionTransaction.aggregate(pipeline)) as Array<Record<string, any>>;
  const truncated = fetched.length > REPORT_ROW_LIMIT;
  const rows = fetched.slice(0, REPORT_ROW_LIMIT);
  const totals = rows.reduce(
    (result, row) => ({
      transactions: result.transactions + Number(row.transactions || 0),
      disbursed: result.disbursed + Number(row.disbursedAmount || 0),
      income: result.income + Number(row.income || 0),
      paid: result.paid + Number(row.paidAmount || 0),
    }),
    { transactions: 0, disbursed: 0, income: 0, paid: 0 },
  );
  return {
    title: "Revenue Report",
    description: "Commission and fee ledger totals by date, product and assigned partner.",
    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "productCategory", label: "Category" },
      { key: "productType", label: "Product type" },
      { key: "partner", label: "Partner" },
      { key: "transactions", label: "Records", format: "number" },
      { key: "disbursedAmount", label: "Disbursed amount", format: "currency" },
      { key: "income", label: "Commission / fee", format: "currency" },
      { key: "paidAmount", label: "Paid amount", format: "currency" },
    ],
    rows,
    summary: [
      { label: "Ledger records", value: totals.transactions, format: "number" },
      { label: "Disbursed amount", value: totals.disbursed, format: "currency" },
      { label: "Commission / fee", value: totals.income, format: "currency" },
      { label: "Paid amount", value: totals.paid, format: "currency" },
    ],
    note: "Values are sourced from the canonical commission ledger; partner is resolved from the linked application assignment.",
    truncated,
  };
};

const userRegistrationsReport = async (req: Request): Promise<ReportResult> => {
  const base: Record<string, any> = { isDeleted: { $ne: true } };
  const range = dateRange(req.query);
  if (range) base.createdAt = range;
  const source = enumValue(
    req.query.source,
    Object.values(RegistrationSource),
    "source",
  );
  if (source) base.registrationSource = source;
  const city = clean(req.query.city);
  const pipeline: any[] = [
    { $match: base },
    {
      $addFields: {
        reportCity: {
          $ifNull: [
            { $arrayElemAt: ["$addresses.city", 0] },
            {
              $ifNull: [
                "$kycProfile.personalDetails.city",
                "$kycProfile.addressDetails.currentAddress.city",
              ],
            },
          ],
        },
      },
    },
    ...(city ? [{ $match: { reportCity: exactRegex(city) } }] : []),
    { $sort: { createdAt: -1 } },
    { $limit: REPORT_ROW_LIMIT + 1 },
    {
      $project: {
        _id: 1,
        registrationDate: "$createdAt",
        customerId: { $ifNull: ["$customerId", { $toString: "$_id" }] },
        name: 1,
        city: { $ifNull: ["$reportCity", "Not captured"] },
        source: { $ifNull: ["$registrationSource", { $ifNull: ["$accountSource", "unknown"] }] },
        status: 1,
      },
    },
  ];
  const fetched = (await User.aggregate(pipeline)) as Array<Record<string, any>>;
  const truncated = fetched.length > REPORT_ROW_LIMIT;
  const rows = fetched.slice(0, REPORT_ROW_LIMIT);
  const active = rows.filter((row) => row.status === "active").length;
  const cities = new Set(rows.map((row) => row.city).filter(Boolean));
  return {
    title: "User Registration Report",
    description: "New customer registrations by date, city and acquisition source.",
    columns: [
      { key: "registrationDate", label: "Registered on", format: "date" },
      { key: "customerId", label: "Customer ID" },
      { key: "name", label: "Name" },
      { key: "city", label: "City" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status" },
    ],
    rows,
    summary: [
      { label: "Registrations", value: rows.length, format: "number" },
      { label: "Active users", value: active, format: "number" },
      { label: "Active rate", value: roundedRate(active, rows.length), format: "percentage" },
      { label: "Cities", value: cities.size, format: "number" },
    ],
    truncated,
  };
};

const websiteTrafficReport = async (req: Request): Promise<ReportResult> => {
  const match: Record<string, any> = { eventType: "page_view" };
  const range = dateRange(req.query);
  if (range) match.createdAt = range;
  if (req.query.source) match.source = exactRegex(req.query.source);
  if (req.query.deviceType) {
    match.deviceType = enumValue(
      req.query.deviceType,
      ["mobile", "desktop", "tablet", "unknown"],
      "deviceType",
    );
  }
  const pagePath = clean(req.query.pagePath, 500);
  if (pagePath) match.pagePath = new RegExp(escapeRegex(pagePath), "i");
  const [totalPageViews, sessionRows, pageRows] = await Promise.all([
    EngagementEvent.countDocuments(match),
    EngagementEvent.aggregate([
      { $match: { ...match, sessionId: { $nin: [null, ""] } } },
      { $group: { _id: "$sessionId", pageViews: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          sessions: { $sum: 1 },
          bounced: { $sum: { $cond: [{ $eq: ["$pageViews", 1] }, 1, 0] } },
        },
      },
    ]),
    EngagementEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$pagePath",
          pageViews: { $sum: 1 },
          sessions: { $addToSet: "$sessionId" },
          visitors: { $addToSet: "$visitorId" },
        },
      },
      {
        $project: {
          _id: 0,
          page: "$_id",
          pageViews: 1,
          sessions: {
            $size: {
              $filter: {
                input: "$sessions",
                cond: { $and: [{ $ne: ["$$this", null] }, { $ne: ["$$this", ""] }] },
              },
            },
          },
          visitors: {
            $size: {
              $filter: {
                input: "$visitors",
                cond: { $and: [{ $ne: ["$$this", null] }, { $ne: ["$$this", ""] }] },
              },
            },
          },
        },
      },
      { $sort: { pageViews: -1 } },
      { $limit: 500 },
    ]),
  ]);
  const sessions = Number(sessionRows[0]?.sessions || 0);
  const bounced = Number(sessionRows[0]?.bounced || 0);
  return {
    title: "Website Traffic Summary",
    description: "Page views, sessions and estimated bounce rate from first-party website analytics.",
    columns: [
      { key: "page", label: "Page" },
      { key: "pageViews", label: "Page views", format: "number" },
      { key: "sessions", label: "Sessions", format: "number" },
      { key: "visitors", label: "Visitors", format: "number" },
    ],
    rows: pageRows,
    summary: [
      { label: "Page views", value: totalPageViews, format: "number" },
      { label: "Sessions", value: sessions, format: "number" },
      { label: "Bounced sessions", value: bounced, format: "number" },
      { label: "Bounce rate", value: roundedRate(bounced, sessions), format: "percentage" },
    ],
    note: "Source: Fintaraa first-party engagement events. Bounce rate is estimated as sessions with one tracked page view; GA4 Data API is not configured in this service.",
  };
};

const reportBuilders: Record<ReportKey, (req: Request) => Promise<ReportResult>> = {
  "loan-applications": loanApplicationsReport,
  "insurance-applications": insuranceApplicationsReport,
  "credit-card-applications": creditCardApplicationsReport,
  "lead-sources": leadSourcesReport,
  "dsa-performance": dsaPerformanceReport,
  "partner-performance": partnerPerformanceReport,
  revenue: revenueReport,
  "user-registrations": userRegistrationsReport,
  "website-traffic": websiteTrafficReport,
};

export class ReportingController {
  static async options(_req: Request, res: Response) {
    const [
      partners,
      dsas,
      loanCities,
      insuranceCities,
      userCities,
      banks,
      cardTypes,
    ] = await Promise.all([
      Partner.find({ isDeleted: false })
        .select("name type status")
        .sort({ name: 1 })
        .lean(),
      Agency.find({ role: "agency" })
        .select("name businessName agencyId referralCode status")
        .sort({ businessName: 1, name: 1 })
        .lean(),
      LoanQuery.distinct("city", { isDeleted: { $ne: true } }),
      InsuranceQuery.distinct("city", { isDeleted: { $ne: true } }),
      User.distinct("addresses.city", { isDeleted: { $ne: true } }),
      BankProduct.distinct("bankName", { type: "credit_card" }),
      BankProduct.distinct("cardType", { type: "credit_card" }),
    ]);
    const cities = Array.from(
      new Set(
        [...loanCities, ...insuranceCities, ...userCities]
          .map((item) => clean(item))
          .filter(Boolean),
      ),
    ).sort((first, second) => first.localeCompare(second));
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          loanTypes: Object.values(LoanType).filter(
            (value) => value !== LoanType.CREDIT_CARD,
          ),
          insuranceTypes: Object.values(InsuranceType),
          applicationStatuses: Object.values(ApplicationStatus),
          registrationSources: Object.values(RegistrationSource),
          leadSources: ["seo", "paid", "referral", "whatsapp", "missed_call", "other"],
          partnerTypes: Object.values(PartnerType),
          earningStatuses: ["pending", "earned", "paid", "reversed", "clawback_required"],
          productCategories: ["loan", "insurance", "credit_card"],
          deviceTypes: ["mobile", "desktop", "tablet", "unknown"],
          cities,
          banks: banks.map(clean).filter(Boolean).sort(),
          cardTypes: cardTypes.map(clean).filter(Boolean).sort(),
          partners: partners.map((partner: any) => ({
            value: String(partner._id),
            label: partner.name,
            type: partner.type,
          })),
          dsas: dsas.map((dsa: any) => ({
            value: String(dsa._id),
            label: dsa.businessName || dsa.name,
            helper: dsa.agencyId || dsa.referralCode,
          })),
        },
        "Reporting filter options fetched",
      ),
    );
  }

  static async report(req: Request, res: Response) {
    const reportKey = clean(req.params.report, 80) as ReportKey;
    if (!reportKeys.has(reportKey)) {
      throw new ApiError(404, "Report type was not found");
    }
    const report = await reportBuilders[reportKey](req);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ...report,
          reportKey,
          generatedAt: new Date().toISOString(),
          appliedFilters: Object.fromEntries(
            Object.entries(req.query)
              .map(([key, value]) => [key, clean(value, 500)])
              .filter(([, value]) => Boolean(value)),
          ),
        },
        `${report.title} generated successfully`,
      ),
    );
  }
}
