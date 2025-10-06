import Role from "../../modals/role.model";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";

const RoleService = new CommonService(Role);

export class RoleController {
  static async createRole(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await RoleService.create(req.body);
      if (!result)
        return res.status(400).json(new ApiError(400, "Failed to create role"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $project: {
            _id: 1,
            name: 1,
            createdAt: 1,
            updatedAt: 1,
            description: 1,
          },
        },
      ];
      const result = await RoleService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getRoleById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await RoleService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "role not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateRoleById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await RoleService.updateById(req.params.id, req.body);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to update role"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteRoleById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await RoleService.deleteById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete role"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
