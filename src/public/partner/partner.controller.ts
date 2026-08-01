import { Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  Partner,
  PartnerProductCategory,
  PartnerStatus,
  PartnerType,
} from "../../modals/partner.model";
import { PartnerProduct } from "../../modals/partnerProduct.model";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePagination = (req: Request) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.limit || "24"), 10) || 24),
  );
  return { page, limit, skip: (page - 1) * limit };
};

const assertEnum = <T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value) as T;
  if (!values.includes(normalized)) {
    throw new ApiError(400, `${label} must be one of: ${values.join(", ")}`);
  }
  return normalized;
};

export class PublicPartnerController {
  static async list(req: Request, res: Response) {
    const { page, limit, skip } = parsePagination(req);
    const type = assertEnum(
      req.query.type,
      Object.values(PartnerType),
      "type",
    );
    const category = assertEnum(
      req.query.category,
      Object.values(PartnerProductCategory),
      "category",
    );
    const search = String(req.query.search || "").trim();
    const featured =
      req.query.featured === undefined
        ? undefined
        : String(req.query.featured).toLowerCase() === "true";
    const match: Record<string, any> = {
      status: PartnerStatus.ACTIVE,
      isDeleted: false,
      ...(type ? { type } : {}),
      ...(featured !== undefined ? { featured } : {}),
      ...(search
        ? {
            $or: [
              { name: { $regex: escapeRegex(search), $options: "i" } },
              { description: { $regex: escapeRegex(search), $options: "i" } },
            ],
          }
        : {}),
    };
    const productMatch: Record<string, any> = {
      $expr: { $eq: ["$partner", "$$partnerId"] },
      isDeleted: false,
      active: true,
      published: true,
      ...(category ? { category } : {}),
    };
    const basePipeline: any[] = [
      { $match: match },
      {
        $lookup: {
          from: PartnerProduct.collection.name,
          let: { partnerId: "$_id" },
          pipeline: [
            { $match: productMatch },
            { $project: { _id: 1, category: 1 } },
          ],
          as: "availableProducts",
        },
      },
      ...(category ? [{ $match: { "availableProducts.0": { $exists: true } } }] : []),
      {
        $addFields: {
          productCount: { $size: "$availableProducts" },
          availableCategories: {
            $setUnion: ["$availableProducts.category", []],
          },
        },
      },
      {
        $project: {
          name: 1,
          slug: 1,
          logo: 1,
          type: 1,
          featured: 1,
          priority: 1,
          website: 1,
          description: 1,
          regulatoryIds: 1,
          productCategories: "$availableCategories",
          serviceAreas: 1,
          productCount: 1,
          availableCategories: 1,
        },
      },
    ];
    const [result] = await Partner.aggregate([
      ...basePipeline,
      {
        $facet: {
          items: [
            { $sort: { featured: -1, priority: 1, name: 1 } },
            { $skip: skip },
            { $limit: limit },
          ],
          metadata: [{ $count: "total" }],
        },
      },
    ]);
    const total = Number(result?.metadata?.[0]?.total || 0);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          items: result?.items || [],
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
        "Partners fetched successfully",
      ),
    );
  }

  static async detail(req: Request, res: Response) {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const partner = (await Partner.findOne({
      slug,
      status: PartnerStatus.ACTIVE,
      isDeleted: false,
    })
      .select(
        "name slug logo type featured priority website description regulatoryIds productCategories serviceAreas createdAt updatedAt",
      )
      .lean()) as Record<string, any> | null;
    if (!partner) throw new ApiError(404, "Partner not found");

    const productSummary = await PartnerProduct.aggregate([
      {
        $match: {
          partner: partner._id,
          isDeleted: false,
          active: true,
          published: true,
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          productTypes: { $addToSet: "$productType" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ...partner,
          productCategories: productSummary.map((item) => item._id),
          productCount: productSummary.reduce(
            (total, item) => total + Number(item.count || 0),
            0,
          ),
          productSummary: productSummary.map((item) => ({
            category: item._id,
            count: item.count,
            productTypes: item.productTypes,
          })),
        },
        "Partner fetched successfully",
      ),
    );
  }

  static async products(req: Request, res: Response) {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const category = assertEnum(
      req.query.category,
      Object.values(PartnerProductCategory),
      "category",
    );
    const partner = await Partner.findOne({
      slug,
      status: PartnerStatus.ACTIVE,
      isDeleted: false,
    })
      .select("_id name slug logo type")
      .lean();
    if (!partner) throw new ApiError(404, "Partner not found");

    const products = await PartnerProduct.find({
      partner: partner._id,
      isDeleted: false,
      active: true,
      published: true,
      ...(category ? { category } : {}),
    })
      .select(
        "category productType code name description interestRateMin interestRateMax processingFee amountMin amountMax tenureMinMonths tenureMaxMonths eligibility insurance priority",
      )
      .sort({ priority: 1, name: 1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(
        200,
        { partner, items: products, total: products.length },
        "Partner products fetched successfully",
      ),
    );
  }
}
