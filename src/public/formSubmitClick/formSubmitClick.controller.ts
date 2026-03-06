import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { FormSubmitClick, IFormSubmitClick } from "../../modals/formSubmitClick.model";
import { Agency } from "../../modals/agency.model";
import { User } from "../../modals/user.model";
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

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const extractIdString = (value: any): string | undefined => {
  if (value === null || value === undefined) return undefined;

  const visited = new Set<any>();
  let current: any = value;

  while (current !== null && current !== undefined) {
    if (typeof current === "string") return asTrimmedString(current);
    if (typeof current === "number" || typeof current === "bigint") {
      const parsed = String(current);
      return parsed.trim() ? parsed : undefined;
    }

    if (current instanceof Types.ObjectId) return current.toString();

    if (typeof current === "object") {
      if (visited.has(current)) return undefined;
      visited.add(current);

      if (typeof current.toHexString === "function") {
        const hex = current.toHexString();
        return asTrimmedString(hex);
      }

      if (current._id && current._id !== current) {
        current = current._id;
        continue;
      }

      if (typeof current.id === "string") {
        return asTrimmedString(current.id);
      }
    }

    if (Types.ObjectId.isValid(current)) return String(current);
    return undefined;
  }

  return undefined;
};

const isAgencyRole = (role?: string) =>
  role === "agency" || role === "agency_member";

const toObjectIdIfValid = (value?: string) => {
  if (!value || !Types.ObjectId.isValid(value)) return undefined;
  return new Types.ObjectId(value);
};

const mergeScopedMatch = (
  base: Record<string, any>,
  scope?: Record<string, any> | null,
) => {
  if (!scope || Object.keys(scope).length === 0) return base;
  return { $and: [base, scope] };
};

const buildSelfScopeMatch = async (authUser: any) => {
  const actorId = extractIdString(authUser?._id);
  const role = asTrimmedString(authUser?.role);
  if (!actorId) return null;

  const actorObjectId = toObjectIdIfValid(actorId);
  if (role === "agency") {
    const scope: any[] = [
      { "meta.actorId": actorId },
      { "meta.agencyId": actorId },
      { "meta.parentAgencyId": actorId },
    ];
    if (actorObjectId) scope.push({ user: actorObjectId });
    return { $or: scope };
  }

  if (role === "agency_member") {
    const member = await Agency.findById(actorId).select("parentAgency").lean();
    const parentAgencyId = extractIdString((member as any)?.parentAgency);

    const scope: any[] = [
      { "meta.actorId": actorId },
      { "meta.agencyId": actorId },
      { "meta.parentAgencyId": actorId },
    ];
    if (parentAgencyId) {
      scope.push({ "meta.agencyId": parentAgencyId });
      scope.push({ "meta.parentAgencyId": parentAgencyId });
    }
    if (actorObjectId) scope.push({ user: actorObjectId });
    return { $or: scope };
  }

  const fallbackScope: any[] = [{ "meta.actorId": actorId }];
  if (actorObjectId) fallbackScope.push({ user: actorObjectId });
  return { $or: fallbackScope };
};

const enrichActors = async (items: Array<Record<string, any>>) => {
  if (!items.length) return items;

  const userIds = new Set<string>();
  const agencyIds = new Set<string>();

  items.forEach((item) => {
    const actorRole = asTrimmedString(item?.meta?.actorRole)
      || asTrimmedString(item?.meta?.actorKind);
    const actorId = extractIdString(item?.meta?.actorId) || extractIdString(item?.user);
    if (!actorId || !Types.ObjectId.isValid(actorId)) return;
    if (isAgencyRole(actorRole)) {
      agencyIds.add(actorId);
    } else {
      userIds.add(actorId);
    }
  });

  const [users, agencies] = await Promise.all([
    userIds.size
      ? User.find({ _id: { $in: Array.from(userIds) } })
          .select("_id name fullName email mobile")
          .lean()
      : [],
    agencyIds.size
      ? Agency.find({ _id: { $in: Array.from(agencyIds) } })
          .select("_id name email mobile role parentAgency")
          .lean()
      : [],
  ]);

  const userMap = new Map<string, any>(
    (users as any[]).map((user) => [String(user?._id), user])
  );
  const agencyMap = new Map<string, any>(
    (agencies as any[]).map((agency) => [String(agency?._id), agency])
  );

  return items.map((item) => {
    const meta = item?.meta || {};
    const actorRole = asTrimmedString(meta.actorRole) || asTrimmedString(meta.actorKind);
    const actorId = extractIdString(meta.actorId) || extractIdString(item?.user);
    const fallbackUser =
      item?.user && typeof item.user === "object" ? item.user : undefined;
    const actorDoc =
      (actorId && isAgencyRole(actorRole) ? agencyMap.get(actorId) : undefined)
      || (actorId ? userMap.get(actorId) : undefined)
      || fallbackUser;

    const actorKind =
      asTrimmedString(meta.actorKind)
      || (isAgencyRole(actorRole) ? actorRole : "user");
    const displayName =
      actorDoc?.fullName
      || actorDoc?.name
      || asTrimmedString(meta.leadPhone)
      || "Unknown";

    const actor = {
      _id: actorId || actorDoc?._id,
      role: actorRole || actorDoc?.role || actorKind,
      kind: actorKind,
      name: actorDoc?.name || actorDoc?.fullName || undefined,
      fullName: actorDoc?.fullName || actorDoc?.name || undefined,
      mobile: actorDoc?.mobile || asTrimmedString(meta.leadPhone),
      email: actorDoc?.email,
      parentAgency: actorDoc?.parentAgency || asTrimmedString(meta.parentAgencyId),
      agencyId: asTrimmedString(meta.agencyId),
      displayName,
    };

    const result: Record<string, any> = {
      ...item,
      actor,
    };

    if (!result.user || typeof result.user !== "object") {
      result.user = {
        _id: actor._id,
        name: actor.name || actor.displayName,
        fullName: actor.fullName || actor.name || actor.displayName,
        mobile: actor.mobile,
        email: actor.email,
      };
    }

    return result;
  });
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
        actorKind,
        actorRole,
        agencyId,
        leadId,
        source,
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
      if (typeof actorKind === "string" && actorKind.trim()) {
        filter["meta.actorKind"] = actorKind.trim();
      }
      if (typeof actorRole === "string" && actorRole.trim()) {
        filter["meta.actorRole"] = actorRole.trim();
      }
      if (typeof agencyId === "string" && agencyId.trim()) {
        filter["meta.agencyId"] = agencyId.trim();
      }
      if (typeof leadId === "string" && leadId.trim()) {
        filter["meta.leadId"] = leadId.trim();
      }
      if (typeof source === "string" && source.trim()) {
        filter["meta.source"] = source.trim();
      }
      if (
        typeof search === "string" &&
        search.trim() &&
        typeof searchkey === "string" &&
        [
          "formType",
          "action",
          "meta.actorKind",
          "meta.actorRole",
          "meta.agencyId",
          "meta.leadId",
          "meta.source",
        ].includes(searchkey)
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

      const [itemsRaw, total] = await Promise.all([
        FormSubmitClick.find(filter)
          .populate("user", "name fullName email mobile")
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        FormSubmitClick.countDocuments(filter),
      ]);
      const items = await enrichActors(itemsRaw as any[]);

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
      const {
        startDate,
        endDate,
        actorKind,
        actorRole,
        agencyId,
        leadId,
        source,
        formType,
        action,
      } = req.query;
      const { start, end } = buildDateRange(
        typeof startDate === "string" ? startDate : undefined,
        typeof endDate === "string" ? endDate : undefined
      );
      const match: Record<string, any> = { createdAt: { $gte: start, $lte: end } };
      if (typeof formType === "string" && formType.trim()) {
        match.formType = formType.trim();
      }
      if (typeof action === "string" && action.trim()) {
        match.action = action.trim();
      }
      if (typeof actorKind === "string" && actorKind.trim()) {
        match["meta.actorKind"] = actorKind.trim();
      }
      if (typeof actorRole === "string" && actorRole.trim()) {
        match["meta.actorRole"] = actorRole.trim();
      }
      if (typeof agencyId === "string" && agencyId.trim()) {
        match["meta.agencyId"] = agencyId.trim();
      }
      if (typeof leadId === "string" && leadId.trim()) {
        match["meta.leadId"] = leadId.trim();
      }
      if (typeof source === "string" && source.trim()) {
        match["meta.source"] = source.trim();
      }

      const [
        byAction,
        byFormType,
        byActorKind,
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
              _id: { $ifNull: ["$meta.actorKind", "unknown"] },
              count: { $sum: 1 },
            },
          },
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
      const enrichedIncomplete = await enrichActors(recentIncomplete as any[]);

      return res.status(200).json(
        new ApiResponse(200, {
          byAction,
          byFormType,
          byActorKind,
          byActionAndFormType,
          dailyTotals,
          dailyByAction,
          dailyByFormType,
          recentIncomplete: enrichedIncomplete,
        })
      );
    } catch (err) {
      next(err);
    }
  }

  static async getMyEvents(req: Request | any, res: Response, next: NextFunction) {
    try {
      const {
        page = "1",
        limit = "20",
        action,
        formType,
        actorKind,
        actorRole,
        leadId,
        source,
        startDate,
        endDate,
        search,
        searchkey,
        sortKey = "createdAt",
        sortDir = "desc",
      } = req.query;
      const { start, end } = buildDateRange(
        typeof startDate === "string" ? startDate : undefined,
        typeof endDate === "string" ? endDate : undefined,
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
      if (typeof actorKind === "string" && actorKind.trim()) {
        filter["meta.actorKind"] = actorKind.trim();
      }
      if (typeof actorRole === "string" && actorRole.trim()) {
        filter["meta.actorRole"] = actorRole.trim();
      }
      if (typeof leadId === "string" && leadId.trim()) {
        filter["meta.leadId"] = leadId.trim();
      }
      if (typeof source === "string" && source.trim()) {
        filter["meta.source"] = source.trim();
      }
      if (
        typeof search === "string" &&
        search.trim() &&
        typeof searchkey === "string" &&
        [
          "formType",
          "action",
          "meta.actorKind",
          "meta.actorRole",
          "meta.leadId",
          "meta.source",
        ].includes(searchkey)
      ) {
        filter[searchkey] = { $regex: search.trim(), $options: "i" };
      }

      const scopeMatch = await buildSelfScopeMatch(req.user);
      const finalFilter = mergeScopedMatch(filter, scopeMatch);
      const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
      const limitNum = Math.min(
        Math.max(parseInt(limit as string, 10) || 20, 1),
        100,
      );
      const skip = (pageNum - 1) * limitNum;
      const sortDirection = String(sortDir).toLowerCase() === "asc" ? 1 : -1;
      const sort: Record<string, 1 | -1> = {};
      if (typeof sortKey === "string" && sortKey.trim()) {
        sort[sortKey] = sortDirection;
      } else {
        sort.createdAt = -1;
      }

      const [itemsRaw, total] = await Promise.all([
        FormSubmitClick.find(finalFilter)
          .populate("user", "name fullName email mobile")
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        FormSubmitClick.countDocuments(finalFilter),
      ]);
      const items = await enrichActors(itemsRaw as any[]);
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
        }),
      );
    } catch (err) {
      next(err);
    }
  }

  static async getMySummary(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const {
        startDate,
        endDate,
        actorKind,
        actorRole,
        leadId,
        source,
        formType,
        action,
      } = req.query;
      const { start, end } = buildDateRange(
        typeof startDate === "string" ? startDate : undefined,
        typeof endDate === "string" ? endDate : undefined,
      );
      const match: Record<string, any> = {
        createdAt: { $gte: start, $lte: end },
      };
      if (typeof formType === "string" && formType.trim()) {
        match.formType = formType.trim();
      }
      if (typeof action === "string" && action.trim()) {
        match.action = action.trim();
      }
      if (typeof actorKind === "string" && actorKind.trim()) {
        match["meta.actorKind"] = actorKind.trim();
      }
      if (typeof actorRole === "string" && actorRole.trim()) {
        match["meta.actorRole"] = actorRole.trim();
      }
      if (typeof leadId === "string" && leadId.trim()) {
        match["meta.leadId"] = leadId.trim();
      }
      if (typeof source === "string" && source.trim()) {
        match["meta.source"] = source.trim();
      }

      const scopeMatch = await buildSelfScopeMatch(req.user);
      const finalMatch = mergeScopedMatch(match, scopeMatch);
      const [
        byAction,
        byFormType,
        byActorKind,
        byActionAndFormType,
        dailyTotals,
        dailyByAction,
        dailyByFormType,
        recentIncomplete,
      ] = await Promise.all([
        FormSubmitClick.aggregate([
          { $match: finalMatch },
          { $group: { _id: "$action", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: finalMatch },
          { $group: { _id: "$formType", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: finalMatch },
          {
            $group: {
              _id: { $ifNull: ["$meta.actorKind", "unknown"] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: finalMatch },
          {
            $group: {
              _id: { action: "$action", formType: "$formType" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        FormSubmitClick.aggregate([
          { $match: finalMatch },
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
          { $match: finalMatch },
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
          { $match: finalMatch },
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
        FormSubmitClick.find({
          ...finalMatch,
          action: "profile_incomplete",
        })
          .populate("user", "name fullName email mobile")
          .sort({ createdAt: -1 })
          .limit(25)
          .lean(),
      ]);
      const enrichedIncomplete = await enrichActors(recentIncomplete as any[]);

      return res.status(200).json(
        new ApiResponse(200, {
          byAction,
          byFormType,
          byActorKind,
          byActionAndFormType,
          dailyTotals,
          dailyByAction,
          dailyByFormType,
          recentIncomplete: enrichedIncomplete,
        }),
      );
    } catch (err) {
      next(err);
    }
  }
}
