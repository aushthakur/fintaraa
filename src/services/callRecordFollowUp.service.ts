import { ClientSession, Types } from "mongoose";
import { CallRecord } from "../modals/callRecord.model";
import { ApplicationStatus } from "../modals/insurancequery.model";

const completedLoanApplicationStatuses = new Set<string>([
  ApplicationStatus.COMPLETED,
  ApplicationStatus.COMPLETED_SUCCESS,
  ApplicationStatus.DISBURSED,
  ApplicationStatus.DISBURSED_PARTIAL_FULL,
]);

const terminalLoanApplicationStatuses = new Set<string>([
  ...completedLoanApplicationStatuses,
  ApplicationStatus.REJECTED,
  ApplicationStatus.REJECTED_BY_BANK,
  ApplicationStatus.CANCELLED,
  ApplicationStatus.CANCELLED_BY_CUSTOMER,
  ApplicationStatus.EXPIRED,
  ApplicationStatus.NOT_INTERESTED,
  ApplicationStatus.DROPPED_LOST,
  ApplicationStatus.DUPLICATE,
]);

export const isLoanApplicationCompleted = (status?: unknown) =>
  completedLoanApplicationStatuses.has(String(status || "").trim());

export const isLoanApplicationTerminal = (status?: unknown) =>
  terminalLoanApplicationStatuses.has(String(status || "").trim());

export const syncLinkedCallRecordFollowUp = async ({
  loanQueryId,
  status,
  session,
}: {
  loanQueryId: string | Types.ObjectId;
  status?: unknown;
  session?: ClientSession | null;
}) => {
  const terminal = isLoanApplicationTerminal(status);
  const update: Record<string, any> = {
    $set: {
      followUp: !terminal,
    },
  };

  if (terminal) {
    update.$unset = {
      callbackAt: "",
      callbackNotifiedAt: "",
    };
  }

  return CallRecord.updateMany(
    { loanQueryId: new Types.ObjectId(String(loanQueryId)) },
    update,
    session ? { session } : undefined,
  );
};
