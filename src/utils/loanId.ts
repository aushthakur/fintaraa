import type { ClientSession } from "mongoose";
import {
  allocatePrefixedSequence,
  formatDaySequencePrefix,
} from "./idAllocator";

export const generateLoanId = async (session?: ClientSession) => {
  const prefix = formatDaySequencePrefix(new Date());
  return allocatePrefixedSequence({
    key: `loanId:${prefix}`,
    prefix,
    padLength: 4,
    session,
  });
};
