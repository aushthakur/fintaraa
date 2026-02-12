import { toBoolean } from "validator";
import ApiError from "../utils/ApiError";
import { getPipeline } from "../utils/helper";
import {
  Model,
  Document,
  UpdateQuery,
  PopulateOptions,
  ClientSession,
} from "mongoose";

type PopulateInput = string | PopulateOptions | Array<string | PopulateOptions>;

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

  async getById(id: string, populate: boolean | PopulateInput = true) {
    try {
      const refPaths: string[] = [];
      const query = this.model.findById(id);
      const autoPopulateAll = populate === true;
      const customPopulate = populate && populate !== true;

      if (autoPopulateAll) {
        const schemaPaths = this.model.schema.paths;
        Object.keys(schemaPaths).forEach((key) => {
          const path = schemaPaths[key];
          if ((path as any).options?.ref) {
            query.populate(key);
            refPaths.push(key);
          }
        });
      } else if (customPopulate) {
        if (typeof populate === "string") {
          query.populate(populate);
        } else {
          query.populate(
            populate as PopulateOptions | Array<string | PopulateOptions>,
          );
        }
      }
      const result: any = await query.lean();
      if (!result) throw new Error("Record not found");

      if (autoPopulateAll && refPaths.length > 0) {
        const hydrated: Record<string, any> = { ...result };
        refPaths.forEach((refKey) => {
          const populated = (result as any)[refKey];
          if (
            populated &&
            typeof populated === "object" &&
            "_id" in populated
          ) {
            hydrated[`${refKey}Details`] = populated;
            hydrated[refKey] = populated._id;
          }
        });
        return hydrated;
      }
      return result;
    } catch (error) {
      throw error;
    }
  }

  async getAll(
    query: any = {},
    optionsToBeExtract?: any,
    pipelineOptions?: {
      sortFirst?: boolean;
      lookupsInDataFacet?: boolean;
      prependStages?: any[];
      afterQuery?: (formatted: any) => any;
      pipelineModifier?: (pipeline: any[]) => any[];
    },
  ) {
    try {
      const { afterQuery, ...pipelineConfig } = pipelineOptions || {};
      const { pipeline, options, meta } = getPipeline(
        query,
        optionsToBeExtract,
        pipelineConfig,
      );
      const usePagination = toBoolean(query.pagination ?? "true");
      const page = Math.max(parseInt(query.page, 10) || 1, 1);
      const limit = Math.max(parseInt(query.limit, 10) || 10, 1);

      const aggregateOptions = {
        ...options,
        allowDiskUse: true,
      };

      const aggregate = this.model.aggregate(pipeline);
      if (Object.keys(aggregateOptions).length > 0) {
        aggregate.option(aggregateOptions);
      }
      if (aggregateOptions.allowDiskUse !== false) {
        aggregate.allowDiskUse(true);
      }

      const result = await aggregate.exec();

      if (usePagination) {
        let data: any[] = [];
        let totalItems = 0;
        let nextCursor: string | null = null;

        if (meta?.useCursor) {
          const cursorLimit = meta.limit ?? limit;
          const hasMore = result.length > cursorLimit;
          data = hasMore ? result.slice(0, cursorLimit) : result;

          const getValueByPath = (obj: any, path: string) => {
            return path.split(".").reduce((acc: any, key: string) => {
              if (acc && typeof acc === "object") return acc[key];
              return undefined;
            }, obj);
          };

          const serializeCursorValue = (value: any) => {
            if (value instanceof Date) return value.toISOString();
            if (value && typeof value === "object" && value.toString) {
              return value.toString();
            }
            return value;
          };

          const buildCursor = (doc: any) => {
            const payload: Record<string, any> = {};
            (meta.sortFields || []).forEach((field: any) => {
              const rawValue = getValueByPath(doc, field.field);
              payload[field.field] = serializeCursorValue(rawValue);
            });
            return Buffer.from(JSON.stringify(payload)).toString("base64");
          };

          if (hasMore && data.length > 0) {
            nextCursor = buildCursor(data[data.length - 1]);
          }

          const countPipeline = meta?.countPipeline;
          if (Array.isArray(countPipeline) && countPipeline.length > 0) {
            const countAgg = this.model.aggregate(countPipeline);
            if (Object.keys(aggregateOptions).length > 0) {
              countAgg.option(aggregateOptions);
            }
            if (aggregateOptions.allowDiskUse !== false) {
              countAgg.allowDiskUse(true);
            }
            const countResult = await countAgg.exec();
            totalItems = countResult?.[0]?.total || 0;
          } else {
            totalItems = result.length;
          }
        } else {
          data = result?.[0]?.data || [];
          totalItems = result?.[0]?.total;
        }
        const totalPages = Math.ceil(totalItems / limit);

        const formattedResult = {
          result: data,
          pagination: {
            totalItems,
            totalPages,
            currentPage: page,
            itemsPerPage: limit,
            ...(meta?.useCursor ? { nextCursor } : {}),
          },
        };
        return afterQuery ? afterQuery(formattedResult) : formattedResult;
      }

      return afterQuery ? afterQuery(result) : result;
    } catch (error: any) {
      throw new ApiError(500, error.message || "Failed to fetch data");
    }
  }

  async updateById(
    id: string,
    update: UpdateQuery<T>,
    options?: {
      populate?: boolean | PopulateInput;
      new?: boolean;
      runValidators?: boolean;
      session?: ClientSession;
    },
  ) {
    try {
      const updated = await this.model.findByIdAndUpdate(id, update, {
        new: options?.new ?? true,
        runValidators: options?.runValidators ?? true,
        session: options?.session,
      });
      if (!updated) throw new Error("Record not found for update");
      if (options?.populate) {
        return this.getById(
          id,
          options.populate === true ? true : options.populate,
        );
      }
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
