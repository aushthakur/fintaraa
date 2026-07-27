import type { ClientSession } from "mongoose";
import {
  allocatePrefixedSequence,
  formatYearMonthDaySequencePrefix,
} from "./idAllocator";

type ApplicationReferenceKind = "insurance" | "loan-offer" | "insurance-offer" | "card";

const prefixByKind: Record<ApplicationReferenceKind, string> = {
  insurance: "FT-INS",
  "loan-offer": "FT-LN",
  "insurance-offer": "FT-INS",
  card: "FT-CC",
};

export const generateApplicationId = async (
  kind: ApplicationReferenceKind,
  session?: ClientSession,
) => {
  const datePrefix = formatYearMonthDaySequencePrefix(new Date());
  const prefix = `${prefixByKind[kind]}-${datePrefix}-`;

  return allocatePrefixedSequence({
    key: `applicationId:${kind}:${datePrefix}`,
    prefix,
    padLength: 4,
    session,
  });
};
