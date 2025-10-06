import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Property } from "../../modals/property.model";
import { GalleryItem } from "../../modals/gallery.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const PropertyService = new CommonService(Property);

export class PropertyController {
  static async createProperty(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: owner } = (req as any).user;
      const result = await PropertyService.create({ ...req.body, owner });
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Property"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllProperties(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: owner, role } = (req as any).user;

      const matchStage: any = {};
      if (role !== "admin") matchStage.owner = owner;

      const pipeline: any[] = [
        { $match: matchStage },
        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "ownerDetails"
          }
        },
        { $unwind: { path: "$rooms", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "rooms",
            localField: "_id",
            foreignField: "property",
            as: "rooms"
          }
        },
        { $unwind: { path: "$rooms", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "pricings",
            localField: "rooms._id",
            foreignField: "roomId",
            as: "pricingData"
          }
        },
        { $unwind: { path: "$pricingData", preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            "rooms.cutPrice": {
              $ifNull: ["$pricingData.basePrice", "$rooms.price"]
            },
            "rooms.price": {
              $ifNull: ["$pricingData.currentPrice.pricePerNight", "$rooms.price"]
            }
          }
        },
        {
          $group: {
            _id: "$_id",
            doc: { $first: "$$ROOT" },
            minPrice: { $min: "$rooms.price" },
            totalPrice: { $sum: "$rooms.price" },
            averagePrice: { $avg: "$rooms.price" },
            totalCutPrice: { $sum: "$rooms.cutPrice" },
          }
        },
        {
          $addFields: {
            "doc.minPrice": "$minPrice",
            "doc.totalPrice": "$totalPrice",
            "doc.averagePrice": "$averagePrice",
            "doc.totalCutPrice": "$totalCutPrice",
          }
        },
        { $replaceRoot: { newRoot: "$doc" } },
        {
          $project: {
            _id: 1,
            title: 1,
            status: 1,
            bedrooms: 1,
            bathrooms: 1,
            updatedAt: 1,
            createdAt: 1,
            totalArea: 1,
            totalRooms: 1,
            isVerified: 1,
            propertyType: 1,
            parkingSpaces: 1,
            transactionType: 1,
            minPrice: 1,
            totalPrice: 1,
            averagePrice: 1,
            totalCutPrice: 1,
            ownerName: { $ifNull: ["$ownerDetails.name", "N/A"] },
            ownerEmail: { $ifNull: ["$ownerDetails.email", "N/A"] },
          }
        }
      ];
      const result = await PropertyService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPublicProperties(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline: any[] = [
        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "ownerDetails"
          }
        },
        { $unwind: { path: "$rooms", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "rooms",
            localField: "_id",
            foreignField: "property",
            as: "rooms"
          }
        },
        { $unwind: { path: "$rooms", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "pricings",
            localField: "rooms._id",
            foreignField: "roomId",
            as: "pricingData"
          }
        },
        { $unwind: { path: "$pricingData", preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            "rooms.cutPrice": {
              $ifNull: ["$pricingData.basePrice", "$rooms.price"]
            },
            "rooms.price": {
              $ifNull: ["$pricingData.currentPrice.pricePerNight", "$rooms.price"]
            }
          }
        },
        {
          $group: {
            _id: "$_id",
            doc: { $first: "$$ROOT" },
            minPrice: { $min: "$rooms.price" },
            totalPrice: { $sum: "$rooms.price" },
            averagePrice: { $avg: "$rooms.price" },
            totalCutPrice: { $sum: "$rooms.cutPrice" },
          }
        },
        {
          $addFields: {
            "doc.minPrice": "$minPrice",
            "doc.totalPrice": "$totalPrice",
            "doc.averagePrice": "$averagePrice",
            "doc.totalCutPrice": "$totalCutPrice",
          }
        },
        { $replaceRoot: { newRoot: "$doc" } },
        {
          $lookup: {
            from: "galleryitems",
            let: { propertyId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$propertyId", "$$propertyId"] },
                      { $not: ["$roomId"] }
                    ]
                  }
                }
              },
              { $sort: { order: 1, createdAt: -1 } },
              {
                $project: {
                  url: 1,
                  type: 1,
                  tags: 1,
                  order: 1,
                  category: 1,
                }
              }
            ],
            as: "galleryImages"
          }
        },
        {
          $project: {
            _id: 1,
            title: 1,
            status: 1,
            address: 1,
            bedrooms: 1,
            bathrooms: 1,
            updatedAt: 1,
            createdAt: 1,
            totalArea: 1,
            totalRooms: 1,
            isVerified: 1,
            description: 1,
            propertyType: 1,
            parkingSpaces: 1,
            transactionType: 1,
            minPrice: 1,
            totalPrice: 1,
            averagePrice: 1,
            totalCutPrice: 1,
            galleryImages: 1,
            ownerName: { $ifNull: ["$ownerDetails.name", "N/A"] },
            ownerEmail: { $ifNull: ["$ownerDetails.email", "N/A"] },
          }
        }
      ];
      const result = await PropertyService.getAll({ ...req.query, status: "active" }, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPropertyById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const propertyId = req.params.id;

      // Aggregation pipeline for pricing + property info
      const pipeline: any[] = [
        { $match: { _id: new mongoose.Types.ObjectId(propertyId) } },

        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "ownerDetails",
          },
        },
        {
          $addFields: {
            ownerDetails: { $arrayElemAt: ["$ownerDetails", 0] }
          }
        },
        {
          $lookup: {
            from: "rooms",
            localField: "_id",
            foreignField: "property",
            as: "rooms",
          },
        },

        { $unwind: { path: "$rooms", preserveNullAndEmptyArrays: true } },

        {
          $lookup: {
            from: "pricings",
            localField: "rooms._id",
            foreignField: "roomId",
            as: "pricingData",
          },
        },

        { $unwind: { path: "$pricingData", preserveNullAndEmptyArrays: true } },

        {
          $addFields: {
            "rooms.cutPrice": {
              $ifNull: ["$pricingData.basePrice", "$rooms.price"],
            },
            "rooms.price": {
              $ifNull: [
                "$pricingData.currentPrice.pricePerNight",
                "$rooms.price",
              ],
            },
          },
        },

        {
          $group: {
            _id: "$_id",
            doc: { $first: "$$ROOT" },
            minPrice: { $min: "$rooms.price" },
            totalPrice: { $sum: "$rooms.price" },
            averagePrice: { $avg: "$rooms.price" },
            totalCutPrice: { $sum: "$rooms.cutPrice" },
          },
        },

        {
          $addFields: {
            "doc.minPrice": "$minPrice",
            "doc.totalPrice": "$totalPrice",
            "doc.averagePrice": "$averagePrice",
            "doc.totalCutPrice": "$totalCutPrice",
          },
        },

        { $replaceRoot: { newRoot: "$doc" } },

        {
          $project: {
            _id: 1,
            title: 1,
            rooms: 1,
            status: 1,
            address: 1,
            minPrice: 1,
            bedrooms: 1,
            bathrooms: 1,
            updatedAt: 1,
            createdAt: 1,
            totalArea: 1,
            totalPrice: 1,
            totalRooms: 1,
            isVerified: 1,
            description: 1,
            propertyType: 1,
            averagePrice: 1,
            totalCutPrice: 1,
            parkingSpaces: 1,
            transactionType: 1,
            ownerName: "$ownerDetails.name",
            ownerEmail: "$ownerDetails.email",
            ownerAvatar: "$ownerDetails.avatar",
            ownerCreatedAt: "$ownerDetails.createdAt",
            ownerIsEmailVerified: "$ownerDetails.isEmailVerified",
            ownerIsMobileVerified: "$ownerDetails.isMobileVerified",
          },
        },
      ];

      const resultArr: any = await Property.aggregate(pipeline);
      const result = resultArr[0];

      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Property not found"));
      }

      // Property-level images
      const propertyGallery = await GalleryItem.aggregate([
        {
          $match: {
            propertyId: new mongoose.Types.ObjectId(propertyId),
            $or: [{ roomId: { $exists: false } }, { roomId: null }],
          },
        },
        { $sort: { order: 1, createdAt: -1 } },
        {
          $project: {
            url: 1,
            type: 1,
            category: 1,
            tags: 1,
            order: 1,
          },
        },
      ]);

      // Room-level images (grouped by roomId if needed)
      const roomGallery = await GalleryItem.aggregate([
        {
          $match: {
            propertyId: new mongoose.Types.ObjectId(propertyId),
            roomId: { $exists: true, $ne: null },
          },
        },
        { $sort: { order: 1, createdAt: -1 } },
        {
          $project: {
            url: 1,
            type: 1,
            category: 1,
            tags: 1,
            order: 1,
            roomId: 1,
          },
        },
      ]);

      const responseData = {
        ...result,
        propertyGallery,
        roomGallery,
      };

      return res
        .status(200)
        .json(new ApiResponse(200, responseData, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePropertyById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(id))
        return res
          .status(400)
          .json(new ApiError(400, "Invalid police verification doc ID"));

      const record = await PropertyService.getById(id);
      if (!record) {
        return res.status(404).json(new ApiError(404, "Property not found."));
      }
      const result = await PropertyService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Property"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deletePropertyById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id: owner } = (req as any).user;
      const result = await PropertyService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Property"));
      if (result?.owner.toString() !== owner.toString())
        return res
          .status(404)
          .json(
            new ApiError(404, "You are not allowed to delete this property.")
          );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
