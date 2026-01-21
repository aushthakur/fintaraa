import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { FormSubmitClick, IFormSubmitClick } from "../../modals/formSubmitClick.model";
import { CommonService } from "../../services/common.services";

const FormSubmitClickService = new CommonService<IFormSubmitClick>(
  FormSubmitClick as any
);

const buildDateRange = (startDate?: string, endDate?: string) => {
  const now = new Date();
  const end = endDate ? new Date(endDate) : now;
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

export class FormSubmitClickController {
  static async logEvent(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const payload = {
        ...req.body,
        user: userId,
      };
      const result = await FormSubmitClickService.create(payload as any);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Form submit click recorded"));
    } catch (err) {
      next(err);
    }
  }

  static async listEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = "1",
        limit = "20",
        action,
        formType,
        userId,
        startDate,
        endDate,
        search,
        searchkey,
        sortKey = "createdAt",
        sortDir = "desc",
      } = req.query;
      const { start, end } = buildDateRange(
        typeof startDate === "string" ? startDate : undefined,
        typeof endDate === "string" ? endDate : undefined
      );
      const filter: Record<string, any> = {
        createdAt: { $gte: start, $lte: end },
      };
      if (typeof action === "string" && action.trim()) {
        filter.action = action.trim();
      }
      if (typeof formType === "string" && formType.trim()) {
        filter.formType = formType.trim();
      }
      if (typeof userId === "string" && userId.trim()) {
        filter.user = userId.trim();
      }
      if (
        typeof search === "string" &&
        search.trim() &&
        typeof searchkey === "string" &&
        ["formType", "action"].includes(searchkey)
      ) {
        filter[searchkey] = { $regex: search.trim(), $options: "i" };
      }

      const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
      const limitNum = Math.min(
        Math.max(parseInt(limit as string, 10) || 20, 1),
        100
      );
      const skip = (pageNum - 1) * limitNum;
      const sortDirection = String(sortDir).toLowerCase() === "asc" ? 1 : -1;
      const sort: Record<string, 1 | -1> = {};
      if (typeof sortKey === "string" && sortKey.trim()) {
        sort[sortKey] = sortDirection;
      } else {
        sort.createdAt = -1;
      }

      const [items, total] = await Promise.all([
        FormSubmitClick.find(filter)
          .populate("user", "name fullName email mobile")
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        FormSubmitClick.countDocuments(filter),
      ]);

      const totalPages = Math.ceil((total || 0) / limitNum) || 1;

      return res.status(200).json(
        new ApiResponse(200, {
          result: items,
          pagination: {
            totalItems: total,
            totalPages,
            currentPage: pageNum,
            itemsPerPage: limitNum,
          },
        })
      );
    } catch (err) {
      next(err);
    }
  }

  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const { start, end } = buildDateRange(
        typeof startDate === "string" ? startDate : undefined,
        typeof endDate === "string" ? endDate : undefined
      );
      const match = { createdAt: { $gte: start, $lte: end } };

      const [
        byAction,
        byFormType,
        byActionAndFormType,
        dailyTotals,
        dailyByAction,
        dailyByFormType,
        recentIncomplete,
      ] = await Promise.all([
        FormSubmitClick.aggregate([
          { $match: match },
          { $group: { _id: "$action", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: match },
          { $group: { _id: "$formType", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: match },
          {
            $group: {
              _id: { action: "$action", formType: "$formType" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                date: {
                  $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                },
                action: "$action",
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.date": 1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                date: {
                  $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                },
                formType: "$formType",
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.date": 1 } },
        ]),
        FormSubmitClick.find({ action: "profile_incomplete", ...match })
          .populate("user", "name fullName email mobile")
          .sort({ createdAt: -1 })
          .limit(25)
          .lean(),
      ]);

      return res.status(200).json(
        new ApiResponse(200, {
          byAction,
          byFormType,
          byActionAndFormType,
          dailyTotals,
          dailyByAction,
          dailyByFormType,
          recentIncomplete,
        })
      );
    } catch (err) {
      next(err);
    }
  }
}
