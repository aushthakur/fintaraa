import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { AmenityModel } from "../../modals/amenity.model";
import { CommonService } from "../../services/common.services";
import { Property } from "../../modals/property.model";

const AmenityService = new CommonService(AmenityModel);

export class AmenityController {
  static async createAmenity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await AmenityService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create Amenity"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createManyAmenities(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      if (!Array.isArray(req.body) || req.body.length === 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Request body must be a non-empty array"));
      }
      const result = await AmenityModel.insertMany(req.body, { ordered: false });
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Amenities created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllAmenitys(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await AmenityService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPublicAmenitys(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { propertyId } = req.body;
      const propertyResponse = await Property.findById(propertyId);
      if (!propertyResponse) return res.status(400).json(new ApiError(400, "Property ID is invalid"));

      const ids: any = propertyResponse?.amenities;
      const pipeline: any[] = [];

      if (ids.length > 0) pipeline.push({ $match: { _id: { $in: ids } } });
      pipeline.push({ $project: { _id: 1, name: 1, icon: 1, category: 1 } });

      const result = await AmenityModel.aggregate(pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAmenityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await AmenityService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Amenity not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateAmenityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await AmenityService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update Amenity"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteAmenityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await AmenityService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Amenity"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
