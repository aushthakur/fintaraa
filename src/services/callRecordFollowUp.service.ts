import { ClientSession, Types } from "mongoose";
import { CallRecord } from "../modals/callRecord.model";
import { ApplicationStatus } from "../modals/insurancequery.model";

const completedLoanApplicationStatuses = new Set<string>([
  ApplicationStatus.COMPLETED,
  ApplicationStatus.COMPLETED_SUCCESS,
]);

export const isLoanApplicationCompleted = (status?: unknown) =>
  completedLoanApplicationStatuses.has(String(status || "").trim());

export const syncLinkedCallRecordFollowUp = async ({
  loanQueryId,
  status,
  session,
}: {
  loanQueryId: string | Types.ObjectId;
  status?: unknown;
  session?: ClientSession | null;
}) => {
  const completed = isLoanApplicationCompleted(status);
  const update: Record<string, any> = {
    $set: {
      followUp: !completed,
    },
  };

  if (completed) {
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
