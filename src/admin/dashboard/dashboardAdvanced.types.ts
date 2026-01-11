import type { TimeSeriesPoint } from "./dashboard.types";

export type BreakdownMap = Record<string, number>;

export interface AdvancedDashboardMetrics {
  totals: {
    users: number;
    loanQueries: number;
    insuranceQueries: number;
    offers: number;
    offerApplications: number;
    knowledgeItems: number;
    bankingPartners: number;
    documentLibraryItems: number;
    contests: number;
    financialProducts: number;
  };
  breakdowns: {
    loansByStatus: BreakdownMap;
    loansByType: BreakdownMap;
    insuranceByStatus: BreakdownMap;
    insuranceByType: BreakdownMap;
    offersByStatus: BreakdownMap;
    offersByCategory: BreakdownMap;
    offerApplicationsByStatus: BreakdownMap;
    knowledgeByType: BreakdownMap;
    knowledgeByStatus: BreakdownMap;
    bankingPartnersByStatus: BreakdownMap;
    documentLibraryByStatus: BreakdownMap;
    contestsByStatus: BreakdownMap;
    financialProductsByStatus: BreakdownMap;
  };
  seriesByStatus: {
    loans: Record<string, TimeSeriesPoint[]>;
    insurance: Record<string, TimeSeriesPoint[]>;
  };
}
