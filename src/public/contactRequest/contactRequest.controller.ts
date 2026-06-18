import { NextFunction, Request, Response } from "express";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { CommonService } from "../../services/common.services";
import {
  ContactRequest,
  ContactRequestStatus,
  IContactRequest,
} from "../../modals/contactRequest.model";

const ContactRequestService = new CommonService<IContactRequest>(
  ContactRequest,
);

const nameRegex = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;
const mobileRegex = /^(?:\+91[\s-]?)?[6-9]\d{9}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cityRegex = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;
const validStatuses: ContactRequestStatus[] = [
  "new",
  "contacted",
  "in_progress",
  "closed",
];

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const normalizeMobile = (value: string) =>
  value.replace(/[\s-]/g, "").replace(/^\+91/, "");

const validateCreatePayload = (body: Record<string, unknown>) => {
  const fullName = cleanText(body.fullName);
  const mobile = normalizeMobile(cleanText(body.mobile));
  const email = cleanText(body.email).toLowerCase();
  const city = cleanText(body.city);
  const message = cleanText(body.message).slice(0, 1000);

  if (!nameRegex.test(fullName)) {
    throw new ApiError(400, "Please enter a valid full name.");
  }
  if (!mobileRegex.test(mobile)) {
    throw new ApiError(400, "Please enter a valid 10-digit mobile number.");
  }
  if (!emailRegex.test(email)) {
    throw new ApiError(400, "Please enter a valid email address.");
  }
  if (!cityRegex.test(city)) {
    throw new ApiError(400, "Please enter a valid city.");
  }

  return { fullName, mobile, email, city, message };
};

export class ContactRequestController {
  static async createContactRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const payload = validateCreatePayload(req.body || {});
      const result = await ContactRequestService.create({
        ...payload,
        source: cleanText(req.body?.source) || "website_contact_page",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || "",
      } as Partial<IContactRequest>);

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Request submitted successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getAllContactRequests(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const pipeline = [
        {
          $project: {
            _id: 1,
            fullName: 1,
            mobile: 1,
            email: 1,
            city: 1,
            message: 1,
            status: 1,
            source: 1,
            ipAddress: 1,
            userAgent: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ];

      const result = await ContactRequestService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Contact requests fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getContactRequestById(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await ContactRequestService.getById(req.params.id, false);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Contact request fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async updateContactRequestById(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const status = cleanText(req.body?.status) as ContactRequestStatus;
      if (!validStatuses.includes(status)) {
        throw new ApiError(400, "Invalid contact request status.");
      }

      const result = await ContactRequestService.updateById(
        req.params.id,
        { status } as Partial<IContactRequest>,
        { new: true, runValidators: true },
      );

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Contact request updated"));
    } catch (error) {
      next(error);
    }
  }

  static async deleteContactRequestById(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await ContactRequestService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Contact request not found"));
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Contact request deleted"));
    } catch (error) {
      next(error);
    }
  }
}
