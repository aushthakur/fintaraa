import { LoanQuery } from "../modals/loanquery.model";
import { InsuranceQuery } from "../modals/insurancequery.model";
import { ApplicationStatus } from "../modals/insurancequery.model";

export class LanderService {
  // Get lander dashboard statistics
  static async getLanderDashboardStats(landerId: string) {
    const [
      totalLoanQueries,
      totalInsuranceQueries,
      pendingLoanQueries,
      pendingInsuranceQueries,
      completedLoanQueries,
      completedInsuranceQueries,
      inProgressLoanQueries,
      inProgressInsuranceQueries,
    ] = await Promise.all([
      LoanQuery.countDocuments({ assignedLander: landerId }),
      InsuranceQuery.countDocuments({ assignedLander: landerId }),
      LoanQuery.countDocuments({
        assignedLander: landerId,
        status: ApplicationStatus.PENDING,
      }),
      InsuranceQuery.countDocuments({
        assignedLander: landerId,
        status: ApplicationStatus.PENDING,
      }),
      LoanQuery.countDocuments({
        assignedLander: landerId,
        status: { $in: [ApplicationStatus.COMPLETED, ApplicationStatus.DISBURSED] },
      }),
      InsuranceQuery.countDocuments({
        assignedLander: landerId,
        status: { $in: [ApplicationStatus.COMPLETED, ApplicationStatus.ACTIVE] },
      }),
      LoanQuery.countDocuments({
        assignedLander: landerId,
        status: ApplicationStatus.IN_PROGRESS,
      }),
      InsuranceQuery.countDocuments({
        assignedLander: landerId,
        status: ApplicationStatus.IN_PROGRESS,
      }),
    ]);

    return {
      loanQueries: {
        total: totalLoanQueries,
        pending: pendingLoanQueries,
        completed: completedLoanQueries,
        inProgress: inProgressLoanQueries,
      },
      insuranceQueries: {
        total: totalInsuranceQueries,
        pending: pendingInsuranceQueries,
        completed: completedInsuranceQueries,
        inProgress: inProgressInsuranceQueries,
      },
      totalAssignedTasks: totalLoanQueries + totalInsuranceQueries,
    };
  }
}

