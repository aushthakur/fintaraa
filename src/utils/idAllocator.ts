import type { ClientSession } from "mongoose";
import { Counter } from "../modals/counter.model";

type AllocationOptions = {
  key: string;
  prefix?: string;
  padLength?: number;
  session?: ClientSession;
};

export const allocatePrefixedSequence = async ({
  key,
  prefix = "",
  padLength = 4,
  session,
}: AllocationOptions) => {
  const counter = await Counter.findOneAndUpdate(
    { key },
    [
      {
        $set: {
          seq: { $add: [{ $ifNull: ["$seq", 0] }, 1] },
        },
      },
    ],
    {
      new: true,
      upsert: true,
      ...(session ? { session } : {}),
    },
  );

  const seq = Math.max(Number(counter?.seq || 0), 1);
  return `${prefix}${String(seq).padStart(padLength, "0")}`;
};

export const formatDaySequencePrefix = (date: Date) => {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};
