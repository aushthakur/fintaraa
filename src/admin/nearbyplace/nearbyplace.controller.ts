import mongoose from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { NextFunction, Request, Response } from "express";
import { NearbyPlace } from "../../modals/nearbyplace.model";
import { CommonService } from "../../services/common.services";

const NearByPlacesService = new CommonService(NearbyPlace);

export class NearByPlacesController {
  static async createNearByPlaces(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const imageUrl = req?.body?.imageUrl?.[0]?.url;
      const result = await NearByPlacesService.create({ ...req.body, imageUrl });
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create NearByPlaces"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllNearByPlacess(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await NearByPlacesService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getNearByPlacesById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await NearByPlacesService.getById(
        req.params.id,
        role !== "admin"
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "NearByPlaces not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateNearByPlacesById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id;
      const image = req?.body?.imageUrl?.[0]?.url;

      if (!mongoose.Types.ObjectId.isValid(id))
        return res
          .status(400)
          .json(new ApiError(400, "Invalid places doc ID"));

      const record = await NearByPlacesService.getById(id);
      if (!record) {
        return res
          .status(404)
          .json(new ApiError(404, "Job Requirement (On Demand) not found."));
      }

      let imageUrl;
      if (req?.body?.imageUrl && record.imageUrl)
        imageUrl = await extractImageUrl(
          req?.body?.imageUrl,
          record.imageUrl as string
        );

      const result = await NearByPlacesService.updateById(id, {
        ...req.body,
        imageUrl: imageUrl || image,
      });

      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update NearByPlaces"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteNearByPlacesById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await NearByPlacesService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete NearByPlaces"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
