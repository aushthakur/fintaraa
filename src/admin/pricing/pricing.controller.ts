import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import { Room } from "../../modals/room.model";
import Pricing from "../../modals/pricing.model";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { ListingStatus, Property } from "../../modals/property.model";

const PricingService = new CommonService(Pricing);

export class PricingController {
  static async createPricing(req: Request, res: Response, next: NextFunction) {
    try {
      const { roomId, propertyId } = req.body;

      // Validate ObjectIds
      if (!mongoose.Types.ObjectId.isValid(propertyId)) {
        return res.status(400).json(new ApiError(400, "Invalid Property ID."));
      }
      if (!mongoose.Types.ObjectId.isValid(roomId)) {
        return res.status(400).json(new ApiError(400, "Invalid Room ID."));
      }

      // Check property existence & status
      const propertyExist = await Property.findById(propertyId);
      if (!propertyExist) {
        return res.status(404).json(new ApiError(404, "Property does not exist."));
      }
      if (propertyExist.status !== ListingStatus.ACTIVE) {
        return res.status(400).json(
          new ApiError(
            400,
            "Property is not active. Approval is required before adding pricing."
          )
        );
      }

      // Check room existence
      const roomExist = await Room.findById(roomId);
      if (!roomExist) {
        return res.status(404).json(new ApiError(404, "Room does not exist."));
      }

      // Prevent duplicate pricing per room
      const existingPricing = await Pricing.findOne({ roomId });
      if (existingPricing) {
        return res.status(409).json(
          new ApiError(
            409,
            "Pricing already exists for this room. Please update existing pricing instead."
          )
        );
      }

      const result = await PricingService.create(req.body);
      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to create Pricing."));

      const currentDate: Date = new Date();
      const { pricePerNight, breakdown } = result.getPriceForDate(currentDate);
      result.currentPrice = { date: currentDate, pricePerNight, breakdown };
      result.lastPriceUpdatedAt = new Date();
      await result.save();

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Pricing created successfully."));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPricings(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "rooms",
            as: "roomData",
            localField: "roomId",
            foreignField: "_id",
          }
        },
        {
          $unwind: {
            path: "$roomData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "properties",
            localField: "propertyId",
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
            from: "users",
            localField: "propertyData.owner",
            foreignField: "_id",
            as: "ownerData"
          }
        },
        {
          $unwind: {
            path: "$ownerData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            target: 1,
            currency: 1,
            basePrice: 1,
            priceUnit: 1,
            maxGuests: 1,
            createdAt: 1,
            updatedAt: 1,
            cleaningFee: 1,
            maximumStay: 1,
            minimumStay: 1,
            currentPrice: 1,
            basePricePerNight: 1,
            lastPriceUpdatedAt: 1,
            extraGuestChargePerGuestPerNight: 1,
            roomType: { $ifNull: ["$roomData.type", "N/A"] },
            roomName: { $ifNull: ["$roomData.name", "N/A"] },
            userName: { $ifNull: ["$ownerData.name", "N/A"] },
            userEmail: { $ifNull: ["$ownerData.email", "N/A"] },
            propertyTitle: { $ifNull: ["$propertyData.title", "N/A"] },
            propertyType: { $ifNull: ["$propertyData.propertyType", "N/A"] },
          }
        }
      ];
      const result = await PricingService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Pricing list fetched successfully."));
    } catch (err) {
      next(err);
    }
  }

  static async getPricingById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json(new ApiError(400, "Invalid Pricing ID."));
      }

      const { role } = (req as any).user;
      const result = await PricingService.getById(id, role !== "admin");

      if (!result) {
        return res.status(404).json(new ApiError(404, "Pricing not found."));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Pricing details fetched successfully."));
    } catch (err) {
      next(err);
    }
  }

  static async updatePricingById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json(new ApiError(400, "Invalid Pricing ID."));
      }

      const record = await PricingService.getById(id);
      if (!record) {
        return res.status(404).json(new ApiError(404, "Pricing not found."));
      }

      const updated = await PricingService.updateById(id, req.body);
      if (!updated) {
        return res.status(400).json(new ApiError(400, "Failed to update Pricing."));
      }

      const currentDate: Date = new Date();
      const { pricePerNight, breakdown } = updated.getPriceForDate(currentDate);
      updated.currentPrice = { date: currentDate, pricePerNight, breakdown };
      updated.lastPriceUpdatedAt = new Date();
      await updated.save();

      return res
        .status(200)
        .json(new ApiResponse(200, updated, "Pricing updated successfully."));
    } catch (err) {
      next(err);
    }
  }

  static async deletePricingById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json(new ApiError(400, "Invalid Pricing ID."));
      }

      const deleted = await PricingService.deleteById(id);
      if (!deleted) {
        return res.status(404).json(new ApiError(404, "Pricing not found or already deleted."));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, deleted, "Pricing deleted successfully."));
    } catch (err) {
      next(err);
    }
  }
}
