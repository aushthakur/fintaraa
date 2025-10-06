import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import { Room } from "../../modals/room.model";
import ApiResponse from "../../utils/ApiResponse";
import { deleteFromS3 } from "../../config/s3Uploader";
import { GalleryItem } from "../../modals/gallery.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const GalleryService = new CommonService(GalleryItem);

export class GalleryController {
  static async createGallery(req: Request, res: Response, next: NextFunction) {
    try {
      const { roomId, propertyId, type, category, tags } = req.body;


      const url = req.body.url?.[0]?.url || req.body.url;
      if (!url) {
        return res.status(400).json(new ApiError(400, "Media URL is required"));
      }

      const removeImage = async () => {
        const s3Key = url.split(".com/")[1];
        await deleteFromS3(s3Key)
      }

      const validTypes = ["image", "video", "virtual_tour", "360_view"];
      if (!type || !validTypes.includes(type)) {
        await removeImage();
        return res.status(400).json(new ApiError(400, "Invalid or missing media type"));
      }

      const validCategories = ["exterior", "interior", "room", "amenity", "neighborhood"];
      if (!category || !validCategories.includes(category)) {
        await removeImage();
        return res.status(400).json(new ApiError(400, "Invalid or missing category"));
      }

      if (roomId) {
        const room = await Room.findById(roomId);
        if (!room) {
          await removeImage();
          return res.status(404).json(new ApiError(404, "Room not found"));
        }
        req.body.propertyId = room.property;
      }

      if (!roomId && !propertyId) {
        await removeImage();
        return res.status(400).json(new ApiError(400, "Either roomId or propertyId is required"));
      }

      if (typeof tags === "string") {
        req.body.tags = tags
          .split(",")
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0);
      }

      req.body.order = Number(req.body.order) || 0;
      const result = await GalleryService.create({ ...req.body, url });

      if (!result) return res.status(400).json(new ApiError(400, "Failed to create gallery item"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Gallery item created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllGallerys(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline: any[] = [
        {
          $lookup: {
            from: "rooms",
            localField: "roomId",
            foreignField: "_id",
            as: "room",
          },
        },
        {
          $unwind: {
            path: "$room",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "properties",
            localField: "propertyId",
            foreignField: "_id",
            as: "property",
          },
        },
        {
          $unwind: {
            path: "$property",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            roomName: "$room.name",
            roomFloor: "$room.floor",
            propertyName: "$property.title",
            propertyLocation: "$property.address",
          },
        },
        {
          $project: {
            url: 1,
            type: 1,
            tags: 1,
            order: 1,
            roomId: 1,
            roomName: 1,
            category: 1,
            createdAt: 1,
            updatedAt: 1,
            propertyId: 1,
            propertyName: 1,
            propertyLocation: 1,
          },
        },
      ];

      const result = await GalleryService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getGalleryById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = (req as any).user;
      const result = await GalleryService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res.status(404).json(new ApiError(404, "Gallery not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateGalleryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json(new ApiError(400, "Invalid gallery ID"));
      }

      if (!req.body || Object.keys(req.body).length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "No update data provided"));
      }

      if (req.body.tags && typeof req.body.tags === "string") {
        req.body.tags = req.body.tags
          .split(",")
          .map((tag: string) => tag.trim())
          .filter(Boolean);
      }

      if (req.body.roomId) {
        const room = await Room.findById(req.body.roomId);
        if (room) req.body.propertyId = room.property;
      }

      const result = await GalleryService.updateById(id, req.body);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Gallery not found or update failed"));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Gallery updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteGalleryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { id } = req.params;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json(new ApiError(400, "Invalid gallery ID"));
      }

      const gallery = await GalleryItem.findById(id);
      if (!gallery) {
        return res.status(404).json(new ApiError(404, "Gallery not found"));
      }

      const existing = gallery.url;
      const s3Key = existing.split(".com/")[1];

      const result = await GalleryService.deleteById(id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Gallery"));
      }
      if (s3Key) await deleteFromS3(s3Key);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Gallery deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
