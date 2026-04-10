export type TimeSeriesPoint = { date: string; count: number };
export type AmountSeriesPoint = { date: string; amount: number };

export interface DashboardOverviewResponse {
  range: {
    startDate: string;
    endDate: string;
    timezone: string;
  };
  graphs: {
    newUsers: TimeSeriesPoint[];
    loanApplications: TimeSeriesPoint[];
    insuranceQueries?: TimeSeriesPoint[];
    loanAmounts?: AmountSeriesPoint[];
    insuranceAmounts?: AmountSeriesPoint[];
  };
  advanced?: import("./dashboardAdvanced.types").AdvancedDashboardMetrics;
  top5: {
    newUsers: Array<{
      id: string;
      name: string;
      email: string;
      mobile: string;
      createdAt: string;
      status?: string;
    }>;
    loanApplications: Array<{
      id: string;
      customerId: string;
      name: string;
      email: string;
      mobile: string;
      loanType: string;
      loanAmount: number;
      status: string;
      createdAt: string;
    }>;
    insuranceApplications: Array<{
      id: string;
      customerId: string;
      name: string;
      email: string;
      mobile: string;
      typeOfInsurance: string;
      annualIncome?: number;
      applicationAmount?: number;
      status: string;
      createdAt: string;
    }>;
  };
}
