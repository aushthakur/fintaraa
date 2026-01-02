import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { FormSubmitClick, IFormSubmitClick } from "../../modals/formSubmitClick.model";
import { CommonService } from "../../services/common.services";

const FormSubmitClickService = new CommonService<IFormSubmitClick>(
  FormSubmitClick as any
);

export class FormSubmitClickController {
  static async logEvent(req: Request | any, res: Response, next: NextFunction) {
    try {
      const userId = req.user?._id;
      if (!userId) return res.status(401).json(new ApiError(401, "Unauthorized"));

      const payload = {
        ...req.body,
        user: userId,
      };
      const result = await FormSubmitClickService.create(payload as any);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Form submit click recorded"));
    } catch (err) {
      next(err);
    }
  }
}
