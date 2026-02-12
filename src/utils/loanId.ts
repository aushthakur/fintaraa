import type { ClientSession } from "mongoose";
import { Counter } from "../modals/counter.model";

const formatDatePrefix = (date: Date) => {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

export const generateLoanId = async (session?: ClientSession) => {
  const prefix = formatDatePrefix(new Date());
  const counterKey = `loanId:${prefix}`;
  const counter = await Counter.findOneAndUpdate(
    { key: counterKey },
    { $inc: { seq: 1 }, $setOnInsert: { seq: 0 } },
    {
      new: true,
      upsert: true,
      ...(session ? { session } : {}),
    }
  );
  const seq = counter?.seq ?? 1;
  const suffix = String(seq).padStart(4, "0");
  return `${prefix}${suffix}`;
};
