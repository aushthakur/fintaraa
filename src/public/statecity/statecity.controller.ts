import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { indianCountries, indianStates, region } from "../../config/data";
import { City, Country, PropertyCity, State } from "../../modals/statecity.model";
import mongoose from "mongoose";
import { extractImageUrl } from "../../utils/helper";

const cityService = new CommonService(City);
const stateService = new CommonService(State);
const countryService = new CommonService(Country);
const propertyCityService = new CommonService(PropertyCity);

export class StateCityController {
  static async createStateCity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { state, city, country } = req.query;
      const insertCities = city === "true";
      const insertStates = state === "true";
      const insertCountries = country === "true";
      const { states = [], cities = [], countries = [] } = req.body;

      const insertedCountries: any[] = [];
      const insertedStates: any[] = [];
      const insertedCities: any[] = [];

      // ================== INSERT COUNTRIES ==================
      if (insertCountries && Array.isArray(indianCountries) && indianCountries.length) {
        const countryResult = await Country.insertMany(indianCountries, {
          ordered: false,
        });
        insertedCountries.push(...countryResult);
      }

      if (countries.length) {
        const countryResult = await Country.insertMany(countries, { ordered: false });
        insertedCountries.push(...countryResult);
      }

      // ================== INSERT STATES ==================
      if (insertStates && indianStates?.India && Array.isArray(indianStates.India)) {
        for (const state of indianStates.India) {
          const countryDoc = await Country.findOne({ name: "India" }, { _id: 1 });
          if (!countryDoc) continue;

          insertedStates.push({
            name: state.name,
            code: state.code,
            countryId: countryDoc._id,
          });
        }

        if (insertedStates.length) {
          const stateResult = await State.insertMany(insertedStates, {
            ordered: false,
          });
          insertedStates.length = 0;
          insertedStates.push(...stateResult);
        }
      }

      if (states.length) {
        const preparedStates = [];

        for (const state of states) {
          const countryDoc = await Country.findOne({ name: state.countryName }, { _id: 1 });
          if (!countryDoc) continue;

          preparedStates.push({
            name: state.name,
            code: state.code,
            countryId: countryDoc._id,
          });
        }

        if (preparedStates.length) {
          const stateResult = await State.insertMany(preparedStates, {
            ordered: false,
          });
          insertedStates.push(...stateResult);
        }
      }

      // ================== INSERT CITIES ==================
      if (insertCities && indianStates?.India) {
        for (const state of indianStates.India) {
          const stateDoc = await State.findOne({ name: state.name }, { _id: 1 });
          if (!stateDoc || !region[state.name]) continue;

          const cityPayload = region[state.name].map((cityName: string) => ({
            name: cityName,
            stateId: stateDoc._id,
            isCapital: cityName === state.name,
          }));

          const cityResult = await City.insertMany(cityPayload, {
            ordered: false,
          });
          insertedCities.push(...cityResult);
        }
      }

      if (cities.length) {
        const preparedCities = [];

        for (const city of cities) {
          const stateDoc = await State.findOne({ name: city.stateName }, { _id: 1 });
          if (!stateDoc) continue;

          preparedCities.push({
            name: city.name,
            stateId: stateDoc._id,
            isCapital: !!city.isCapital,
          });
        }

        if (preparedCities.length) {
          const cityResult = await City.insertMany(preparedCities, {
            ordered: false,
          });
          insertedCities.push(...cityResult);
        }
      }

      return res.status(201).json(
        new ApiResponse(
          201,
          {
            insertedCountries: insertedCountries.length,
            insertedStates: insertedStates.length,
            insertedCities: insertedCities.length,
          },
          "Data inserted successfully"
        )
      );
    } catch (err) {
      next(err);
    }
  }

  static async getAllStateCitys(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { city, stateId, countryId } = req.query;

      // 🏙 Fetch Cities by State ID
      if (city === "true") {
        if (!stateId || typeof stateId !== "string") {
          return res
            .status(400)
            .json(new ApiError(400, "Missing or invalid stateId in query"));
        }

        const cities = await City.find({ stateId }, { _id: 1, name: 1 });
        return res
          .status(200)
          .json(new ApiResponse(200, cities, "Cities fetched successfully"));
      }

      // 🌍 Fetch States by Country (with country name/code)
      const pipeline: any[] = [
        {
          $lookup: {
            from: "countries",
            localField: "countryId",
            foreignField: "_id",
            as: "country",
          },
        },
        { $unwind: "$country" },
        {
          $project: {
            _id: 1,
            name: 1,
            code: 1,
            countryId: 1,
            countryName: "$country.name",
            countryCode: "$country.code",
          },
        },
      ];

      if (countryId && typeof countryId === "string") {
        pipeline.unshift({
          $match: { countryId: new mongoose.Types.ObjectId(countryId) },
        });
      }

      const states = await State.aggregate(pipeline);

      return res
        .status(200)
        .json(new ApiResponse(200, states, "States fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createState(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await stateService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create state"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllStates(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [{
        $lookup: {
          from: "countries",
          localField: "countryId",
          foreignField: "_id",
          as: "countryData",
        },
      },
      { $unwind: "$countryData" },
      {
        $project: {
          _id: 1,
          code: 1,
          name: 1,
          countryId: 1,
          createdAt: 1,
          updatedAt: 1,
          countryName: "$countryData.name",
          countryCode: "$countryData.code",
        },
      }];
      const states = await stateService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, states, "States fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getStateById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await stateService.getById(req.params.id, role !== "admin");
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "state not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateStateById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await stateService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update state"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteStateById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await stateService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete state"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllCity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "states",
            localField: "stateId",
            foreignField: "_id",
            as: "stateData",
          },
        },
        { $unwind: "$stateData" },
        {
          $lookup: {
            from: "countries",
            localField: "stateData.countryId",
            foreignField: "_id",
            as: "countryData",
          },
        },
        { $unwind: "$countryData" },
        {
          $project: {
            _id: 1,
            name: 1,
            stateId: 1,
            isCapital: 1,
            createdAt: 1,
            updatedAt: 1,
            stateName: "$stateData.name",
            stateCode: "$stateData.code",
            countryName: "$countryData.name",
            countryCode: "$countryData.code",
          },
        },
      ];
      const states = await cityService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, states, "States fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createCity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await cityService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create city"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getCityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role } = (req as any).user;
      const result = await cityService.getById(req.params.id, role !== "admin");
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "city not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateCityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await cityService.updateById(
        req.params.id,
        req.body
      );
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update city"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteCityById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await cityService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete city"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllPropertyCity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "cities",
            localField: "cityId",
            foreignField: "_id",
            as: "cityData",
          },
        },
        { $unwind: "$cityData" },

        // Lookup state info from city
        {
          $lookup: {
            from: "states",
            localField: "cityData.stateId",
            foreignField: "_id",
            as: "stateData",
          },
        },
        { $unwind: "$stateData" },

        // Lookup country info from state
        {
          $lookup: {
            from: "countries",
            localField: "stateData.countryId",
            foreignField: "_id",
            as: "countryData",
          },
        },
        { $unwind: "$countryData" },

        // Final projection
        {
          $project: {
            _id: 1,
            image: 1,
            isActive: 1,
            createdAt: 1,
            updatedAt: 1,
            cityName: "$cityData.name",
            stateName: "$stateData.name",
            countryName: "$countryData.name",
          },
        },
      ];
      const cities = await propertyCityService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, cities, "Cities fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createProperty(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const image = req?.body?.image?.[0]?.url;
      if (!image)
        return res
          .status(403)
          .json(new ApiError(403, "Banner Image is Required."));

      const result = await propertyCityService.create({ ...req.body, image });
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create city"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
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
      const result = await propertyCityService.getById(req.params.id, role !== "admin");
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "city not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
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
      const image = req?.body?.image?.[0]?.url;
      const record = await propertyCityService.getById(id);
      if (!record) {
        return res
          .status(404)
          .json(new ApiError(404, "Job Requirement (On Demand) not found."));
      }

      let imageUrl;
      if (req?.body?.image && record.image)
        imageUrl = await extractImageUrl(
          req?.body?.image,
          record.image as string
        );
      const result = await propertyCityService.updateById(req.params.id, {
        ...req.body,
        image: imageUrl || image,
      });
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to update city"));
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
      const result = await propertyCityService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete city"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async createCountry(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await countryService.create(req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to create country"));
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllCountries(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const countries = await countryService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, countries, "Countries fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getCountryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await countryService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Country not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updateCountryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await countryService.updateById(req.params.id, req.body);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to update country"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async deleteCountryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await countryService.deleteById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete country"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}