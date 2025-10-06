import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import { Room } from "../../modals/room.model";
import ApiResponse from "../../utils/ApiResponse";
import { GalleryItem } from "../../modals/gallery.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { ListingStatus, Property } from "../../modals/property.model";
import { BookingEnrollment } from "../../modals/bookingenrollment.model";

const RoomService = new CommonService(Room);

export class RoomController {
  static async createRoom(req: Request, res: Response, next: NextFunction) {
    try {
      const { property } = req.body;
      const { _id: user, role } = (req as any).user;

      const propertyExist: any = await Property.findById(property);
      if (!propertyExist)
        return res.status(400).json(new ApiError(400, "Property doesn't exist"));

      if (propertyExist?.status !== ListingStatus.ACTIVE)
        return res.status(400).json(new ApiError(400, "Property is still pending for approval!"));

      // Create room
      const result = await RoomService.create({
        ...req.body,
        ...(role === "admin"
          ? { user: propertyExist?.owner }
          : { user: user }),
      });

      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to create Room"));

      // ✅ Increment usedUnits for the active booking enrollment
      const now = new Date();
      await BookingEnrollment.findOneAndUpdate(
        {
          userId: role === "admin" ? propertyExist?.owner : user,
          status: "active",
          startDate: { $lte: now },
          endDate: { $gte: now },
        },
        { $inc: { usedUnits: 1 } }
      );
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllRooms(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: user, role } = (req as any).user;
      const pipeline = [
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userData"
          }
        },
        {
          $unwind: {
            path: "$userData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "properties",
            localField: "property",
            foreignField: "_id",
            as: "propertyData"
          }
        },
        {
          $unwind: {
            path: "$propertyData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "pricings",
            localField: "_id",
            foreignField: "roomId",
            as: "pricingData"
          }
        },
        {
          $unwind: {
            path: "$pricingData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            cutPrice: { $ifNull: ["$pricingData.basePrice", "$price"] },
            price: {
              $ifNull: ["$pricingData.currentPrice.pricePerNight", "$price"]
            }
          }
        },
        {
          $project: {
            _id: 1,
            type: 1,
            name: 1,
            floor: 1,
            price: 1,
            cutPrice: 1,
            createdAt: 1,
            updatedAt: 1,
            roomCount: 1,
            description: 1,
            maxOccupancy: 1,
            additionalCost: 1,
            userName: { $ifNull: ["$userData.name", "N/A"] },
            userEmail: { $ifNull: ["$userData.email", "N/A"] },
            propertyTitle: { $ifNull: ["$propertyData.title", "N/A"] },
            propertyType: { $ifNull: ["$propertyData.propertyType", "N/A"] },
          }
        }
      ];

      const result = await RoomService.getAll({
        ...req.query,
        ...(role === "admin" ? {} : user),
      },
        pipeline
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPublicRooms(req: Request, res: Response, next: NextFunction) {
    try {
      const { id: property } = (req as any).params;
      const pipeline = [
        {
          $lookup: {
            from: "pricings",
            localField: "_id",
            foreignField: "roomId",
            as: "pricingData"
          }
        },
        {
          $unwind: {
            path: "$pricingData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            cutPrice: { $ifNull: ["$pricingData.basePrice", "$price"] },
            price: {
              $ifNull: ["$pricingData.currentPrice.pricePerNight", "$price"]
            }
          }
        },
        {
          $lookup: {
            from: "galleryitems",
            let: { propertyId: new mongoose.Types.ObjectId(property), roomId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$propertyId", "$$propertyId"] },
                      { $eq: ["$roomId", "$$roomId"] } // ensure roomId also matches
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
                  category: 1
                }
              }
            ],
            as: "galleryImages"
          }
        },
        {
          $project: {
            _id: 1,
            type: 1,
            name: 1,
            floor: 1,
            price: 1,
            cutPrice: 1,
            createdAt: 1,
            updatedAt: 1,
            roomCount: 1,
            amenities: 1,
            description: 1,
            maxOccupancy: 1,
            galleryImages: 1,
            additionalCost: 1,
          }
        }
      ];

      const result = await RoomService.getAll({ ...req.query, property }, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getRoomsById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const roomId = req.params.id;

      const pipeline: any[] = [
        { $match: { _id: new mongoose.Types.ObjectId(roomId) } },
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "ownerDetails",
          },
        },
        { $addFields: { ownerDetails: { $arrayElemAt: ["$ownerDetails", 0] } } },
        {
          $lookup: {
            from: "properties",
            localField: "property",
            foreignField: "_id",
            as: "propertyDetails",
          },
        },
        { $addFields: { propertyDetails: { $arrayElemAt: ["$propertyDetails", 0] } } },

        // Rooms lookup
        {
          $lookup: {
            from: "rooms",
            localField: "_id",
            foreignField: "property",
            as: "rooms",
          },
        },
        {
          $lookup: {
            from: "pricings",
            localField: "_id",
            foreignField: "roomId",
            as: "pricingData"
          }
        },
        {
          $unwind: {
            path: "$pricingData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            cutPrice: { $ifNull: ["$pricingData.basePrice", "$price"] },
            price: {
              $ifNull: ["$pricingData.currentPrice.pricePerNight", "$price"]
            }
          }
        },
        {
          $project: {
            pricingData: 0,
          },
        },
      ];

      const resultArr: any = await Room.aggregate(pipeline);
      const result = resultArr[0];

      if (!result) {
        return res.status(404).json(new ApiError(404, "Property not found"));
      }

      // Property-level images
      const propertyGallery = await GalleryItem.aggregate([
        {
          $match: {
            propertyId: new mongoose.Types.ObjectId(result.property),
            $or: [{ roomId: { $exists: false } }, { roomId: null }],
          },
        },
        { $sort: { order: 1, createdAt: -1 } },
        { $project: { url: 1 } },
      ]);

      // Room-level gallery (both propertyId and roomId exist)
      const roomGallery = await GalleryItem.aggregate([
        {
          $match: {
            propertyId: new mongoose.Types.ObjectId(result.property),
            roomId: { $exists: true, $ne: null },
          },
        },
        { $sort: { order: 1, createdAt: -1 } },
        { $project: { url: 1 } },
      ]);
      const responseData = { ...result, roomGallery, propertyGallery };
      return res
        .status(200)
        .json(new ApiResponse(200, responseData, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getRoomById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await RoomService.getById(req.params.id, role !== "admin");
      if (!result)
        return res.status(404).json(new ApiError(404, "Room not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateRoomById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id;
      const { _id: userId, role } = (req as any).user;

      if (!mongoose.Types.ObjectId.isValid(id))
        return res.status(400).json(new ApiError(400, "Invalid Room ID"));

      const record = await RoomService.getById(id);
      if (!record) return res.status(404).json(new ApiError(404, "Room not found."));

      if (role !== "admin" && record.user.toString() !== userId.toString()) {
        return res.status(403).json(
          new ApiError(403, "You are not allowed to update this room.")
        );
      }

      const result = await RoomService.updateById(id, req.body);
      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to update Room"));

      res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteRoomById(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: user, role } = (req as any).user;
      const result = await RoomService.deleteById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete Room"));

      if (role !== "admin" && result.user.toString() !== user.toString())
        return res
          .status(404)
          .json(new ApiError(404, "You are not allowed to delete this room."));

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
