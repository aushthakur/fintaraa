import { toBoolean } from "validator";
import ApiError from "../utils/ApiError";
import { getPipeline } from "../utils/helper";
import {
  Model,
  Document,
  UpdateQuery,
  PipelineStage,
  AggregateOptions,
  ClientSession,
  QueryOptions as MongooseQueryOptions,
} from "mongoose";

type PopulateDirective =
  | string
  | {
      path: string;
      select?: string | Record<string, unknown>;
      match?: Record<string, unknown>;
      options?: Record<string, unknown>;
      populate?: PopulateDirective | PopulateDirective[];
    };

type PopulateInput =
  | boolean
  | PopulateDirective
  | PopulateDirective[]
  | undefined;

interface QueryExecutionOptions {
  select?: string | Record<string, number>;
  lean?: boolean;
  session?: ClientSession;
}

interface MutationOptions<T extends Document> extends QueryExecutionOptions {
  populate?: PopulateInput;
  new?: boolean;
  runValidators?: boolean;
  queryOptions?: MongooseQueryOptions<T>;
}

interface GetAllExecutionOptions {
  prependStages?: PipelineStage | PipelineStage[];
  appendStages?: PipelineStage | PipelineStage[];
  pipelineModifier?: (pipeline: PipelineStage[]) => PipelineStage[];
  aggregateOptions?: AggregateOptions;
  afterQuery?: (result: any) => Promise<any> | any;
}

export class CommonService<T extends Document> {
  private model: Model<T>;
  private readonly autoPopulatePaths: string[];

  constructor(model: Model<T>) {
    this.model = model;
    this.autoPopulatePaths = this.extractPopulatePaths();
  }

  private extractPopulatePaths(): string[] {
    const schemaPaths = this.model.schema.paths;
    return Object.keys(schemaPaths).filter((key) => {
      const pathOptions = (schemaPaths[key] as any)?.options;
      return Boolean(pathOptions?.ref || pathOptions?.refPath);
    });
  }

  private normalizePopulate(
    populate: PopulateInput
  ): PopulateDirective | PopulateDirective[] | undefined {
    if (!populate) return undefined;
    if (populate === true) return this.autoPopulatePaths;
    return populate;
  }

  private applyPopulate(
    query: any,
    populate?: PopulateDirective | PopulateDirective[]
  ) {
    if (!populate) return;

    const apply = (target: PopulateDirective) => {
      if (typeof target === "string") {
        target
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .forEach((path) => query.populate(path));
        return;
      }
      query.populate({
        ...target,
        populate: target.populate,
      });
    };

    if (Array.isArray(populate)) {
      populate.forEach((item) => apply(item));
      return;
    }
    apply(populate);
  }

  private normalizeStageInput(
    stages?: PipelineStage | PipelineStage[]
  ): PipelineStage[] {
    if (!stages) return [];
    return Array.isArray(stages) ? stages : [stages];
  }

  private applyQueryOptions(query: any, options?: QueryExecutionOptions) {
    if (!options) return;
    if (options.session) query.session(options.session);
    if (options.select) query.select(options.select);
    if (options.lean) query.lean();
  }

  private async formatAggregateResult(
    result: any,
    query: Record<string, any>,
    afterQuery?: (result: any) => Promise<any> | any
  ) {
    const usePagination = toBoolean(query.pagination ?? "true");
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(query.limit, 10) || 10, 1);

    let formatted = result;

    if (usePagination) {
      const data = result?.[0]?.data || [];
      const totalItems = result?.[0]?.total ?? 0;
      const totalPages = Math.ceil((totalItems || 0) / limit);

      formatted = {
        result: data,
        pagination: {
          totalItems,
          totalPages,
          currentPage: page,
          itemsPerPage: limit,
        },
      };
    }

    if (typeof afterQuery === "function") {
      return await afterQuery(formatted);
    }

    return formatted;
  }

  async create(data: Partial<T>) {
    try {
      const created = await this.model.create(data);
      return created;
    } catch (error: any) {
      throw error;
    }
  }

  async getById(
    id: string,
    populate: PopulateInput = true,
    options: QueryExecutionOptions = {}
  ) {
    try {
      const query = this.model.findById(id);
      const populateTarget = this.normalizePopulate(populate);

      this.applyQueryOptions(query, options);
      if (populateTarget) this.applyPopulate(query, populateTarget);

      const result = await query;
      if (!result) throw new ApiError(404, "Record not found");
      return result;
    } catch (error) {
      throw error;
    }
  }

  async getAll(
    query: Record<string, any> = {},
    additionalStages?: PipelineStage | PipelineStage[] | Record<string, any>,
    executionOptions: GetAllExecutionOptions = {}
  ) {
    try {
      const { pipeline, options } = getPipeline(query, additionalStages);

      const finalPipeline = (() => {
        const cloned = [
          ...this.normalizeStageInput(executionOptions.prependStages),
          ...pipeline,
        ];
        const appended = [
          ...cloned,
          ...this.normalizeStageInput(executionOptions.appendStages),
        ];

        if (typeof executionOptions.pipelineModifier === "function") {
          return executionOptions.pipelineModifier([...appended]) || appended;
        }
        return appended;
      })();

      const aggregateOptions: AggregateOptions = {
        ...options,
        ...(executionOptions.aggregateOptions || {}),
      };

      const result = await this.model.aggregate(
        finalPipeline,
        aggregateOptions
      );

      return this.formatAggregateResult(
        result,
        query,
        executionOptions.afterQuery
      );
    } catch (error: any) {
      throw new ApiError(500, error.message || "Failed to fetch data");
    }
  }

  async updateById(
    id: string,
    update: UpdateQuery<T>,
    options: MutationOptions<T> = {}
  ) {
    try {
      const query = this.model.findByIdAndUpdate(id, update, {
        ...(options.queryOptions || {}),
        new: options.new ?? true,
        runValidators: options.runValidators ?? true,
        session: options.session,
      });

      this.applyQueryOptions(query, options);

      const populateTarget = this.normalizePopulate(options.populate);
      if (populateTarget) this.applyPopulate(query, populateTarget);

      const updated = await query;
      if (!updated) throw new ApiError(404, "Record not found for update");
      return updated;
    } catch (error) {
      throw error;
    }
  }

  async deleteById(id: string, options: QueryExecutionOptions = {}) {
    try {
      const deleted = await this.model.findByIdAndDelete(id, {
        session: options.session,
      });
      if (!deleted) throw new ApiError(404, "Record not found for delete");
      return deleted;
    } catch (error) {
      throw error;
    }
  }
}
