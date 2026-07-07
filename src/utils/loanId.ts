import type { ClientSession } from "mongoose";
import {
  allocatePrefixedSequence,
  formatYearMonthDaySequencePrefix,
} from "./idAllocator";

export const generateLoanId = async (session?: ClientSession) => {
  const prefix = formatYearMonthDaySequencePrefix(new Date());
  return allocatePrefixedSequence({
    key: `loanId:${prefix}`,
    prefix,
    padLength: 4,
    session,
  });
};
