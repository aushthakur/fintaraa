import ApiError from "../utils/ApiError";
import { Model, Document, UpdateQuery } from "mongoose";
import { getPipeline, paginationResult } from "../utils/helper";

export class CommonService<T extends Document> {
  private model: Model<T>;

  constructor(model: Model<T>) {
    this.model = model;
  }

  async create(data: Partial<T>) {
    try {
      const created = await this.model.create(data);
      return created;
    } catch (error: any) {
      throw error;
    }
  }

  async getById(id: string, populate: boolean = true) {
    try {
      const query = this.model.findById(id);
      if (populate) {
        const schemaPaths = this.model.schema.paths;
        Object.keys(schemaPaths).forEach((key) => {
          const path = schemaPaths[key];
          if ((path as any).options?.ref) {
            query.populate(key);
          }
        });
      }
      const result = await query;
      if (!result) throw new Error("Record not found");
      return result;
    } catch (error) {
      throw error;
    }
  }

  async getAll(query: any = {}, optionsToBeExtract?: any) {
    try {
      const { pipeline, options } = getPipeline(query, optionsToBeExtract);
      const result = await this.model.aggregate(pipeline, options);

      const { data = [], totalCount = 0 } = result?.[0] || {};
      const page = parseInt(query.page, 10) || 1;
      const limit = parseInt(query.limit, 10) || 10;

      return {
        result: data,
        pagination: {
          currentPage: page,
          itemsPerPage: limit,
          totalItems: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    } catch (error: any) {
      throw new ApiError(500, error.message || "Failed to fetch data");
    }
  }

  async updateById(id: string, update: UpdateQuery<T>) {
    try {
      const updated = await this.model.findByIdAndUpdate(id, update, {
        new: true,
        runValidators: true,
      });
      if (!updated) throw new Error("Record not found for update");
      return updated;
    } catch (error) {
      throw error;
    }
  }

  async deleteById(id: string) {
    try {
      const deleted = await this.model.findByIdAndDelete(id);
      if (!deleted) throw new Error("Record not found for delete");
      return deleted;
    } catch (error) {
      throw error;
    }
  }
}
