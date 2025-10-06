import ApiError from "../../utils/ApiError";
import { User } from "../../modals/user.model";
import ApiResponse from "../../utils/ApiResponse";
import { Payment } from "../../modals/payment.model";
import { Plan } from "../../modals/subscription.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { BookingEnrollment } from "../../modals/bookingenrollment.model";

const PaymentService = new CommonService(Payment);

export class PaymentController {
  static async createPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { planId, method } = req.body;
      const { _id: userId } = (req as any).user;

      if (!planId || !method) {
        return res
          .status(400)
          .json(new ApiError(400, "Plan ID and payment method are required."));
      }

      const validMethods = ["stripe", "razorpay", "paypal", "dpo"];
      if (!validMethods.includes(method)) {
        return res
          .status(400)
          .json(new ApiError(400, `Invalid payment method: ${method}`));
      }

      // Check for pending payment for same plan
      const existingPendingEnrollment = await Payment.findOne({
        planId,
        userId,
        status: "pending",
      });
      if (existingPendingEnrollment) {
        return res
          .status(409)
          .json(
            new ApiError(
              409,
              "You already have a pending enrollment for this plan",
              existingPendingEnrollment
            )
          );
      }

      // Fetch and validate plan
      const planDetails = await Plan.findById(planId);
      if (!planDetails) {
        return res.status(404).json(new ApiError(404, "Plan not found"));
      }

      // Fetch and validate user
      const userDetails = await User.findById(userId);
      if (!userDetails) {
        return res.status(404).json(new ApiError(404, "User not found"));
      }

      req.body = {
        amount: 500,
        customerName: userDetails?.name,
        customerEmail: userDetails?.email,
      }

      // Prevent payment if user already has active enrollment for same plan
      const existingEnrollmentSamePlan = await BookingEnrollment.findOne({
        userId,
        planId,
        status: "active",
      });
      if (existingEnrollmentSamePlan) {
        return res
          .status(409)
          .json(
            new ApiError(
              409,
              "You already have an active subscription for this plan."
            )
          );
      }

      // 🔹 New check: Prevent if user has ANY active plan
      const existingAnyActivePlan = await BookingEnrollment.findOne({
        userId,
        status: "active",
        endDate: { $gte: new Date() },
      }).sort({ endDate: -1 });
      if (existingAnyActivePlan) {
        return res
          .status(409)
          .json(
            new ApiError(
              409,
              `You already have an active plan (${existingAnyActivePlan.planId}). Please wait until it expires before purchasing another.`
            )
          );
      }

      // Calculate amount
      const amount = planDetails.isCustomPricing
        ? 0
        : planDetails.pricePerUnit || 0;

      const meta = { planDetails, userDetails };
      const paymentPayload = {
        meta,
        planId,
        method,
        amount,
        userId,
      };
      const paymentResult = await PaymentService.create(paymentPayload);

      if (!paymentResult) {
        return res
          .status(500)
          .json(new ApiError(500, "Failed to create payment record"));
      }

      return res
        .status(201)
        .json(
          new ApiResponse(201, paymentResult, "Payment initiated successfully")
        );
    } catch (err) {
      next(err);
    }
  }

  static async getAllPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const { role, id: userId } = (req as any).user;
      const result = await PaymentService.getAll({
        ...req.query,
        ...(role === "property" ? { userId } : {}),
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getPaymentById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await PaymentService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Payment not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async updatePaymentById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const paymentExists = await PaymentService.getById(id);
      if (!paymentExists)
        return res.status(404).json(new ApiError(404, "Payment not found"));

      if (paymentExists.status !== "pending") {
        return res
          .status(400)
          .json(
            new ApiError(400, "Payment is already processed", paymentExists)
          );
      }

      // Update payment
      const updatedPayment = await PaymentService.updateById(id, updateData);
      if (!updatedPayment) {
        return res.status(500).json(new ApiError(500, "Payment update failed"));
      }

      // Proceed only if marked as completed
      if (updateData.status === "completed") {
        const plan = await Plan.findById(updatedPayment.planId);
        if (!plan) {
          return res
            .status(404)
            .json(new ApiError(404, "Associated plan not found"));
        }

        // 🔹 Check for active booking for this user
        const activeBooking = await BookingEnrollment.findOne({
          userId: updatedPayment.userId,
          status: "active",
          endDate: { $gte: new Date() },
        }).sort({ endDate: -1 });

        // If user has active plan, start from its end date; otherwise start from now
        const now = new Date();
        const startDate = activeBooking ? new Date(activeBooking.endDate) : now;
        const endDate = new Date(startDate);

        // 🔹 Apply trial/validity logic
        if (plan.trialDays && plan.trialDays > 0 && plan.validity > 0) {
          endDate.setDate(startDate.getDate() + plan.trialDays + plan.validity);
        } else if (plan.validity && plan.validity > 0) {
          endDate.setDate(startDate.getDate() + plan.validity);
        } else endDate.setDate(startDate.getDate() + 30);

        // Units
        const totalUnits = plan.propertyAllowed || 1;
        const additionalUnits = (updatedPayment as any)?.additionalUnits || 0;

        const newBooking = await BookingEnrollment.create({
          startDate,
          endDate,
          usedUnits: 0,
          status: "active",
          autoRenew: false,
          userId: updatedPayment.userId,
          planId: updatedPayment.planId,
          totalUnits: totalUnits + additionalUnits,
          additionalUnitsPurchased: additionalUnits,
          paymentReference: (updatedPayment._id as string).toString(),
        });

        return res.status(200).json(
          new ApiResponse(
            200,
            {
              booking: newBooking,
              payment: updatedPayment,
            },
            activeBooking
              ? "Payment completed and plan extended after previous plan"
              : "Payment and enrollment completed successfully"
          )
        );
      }

      return res
        .status(200)
        .json(new ApiResponse(200, updatedPayment, "Payment updated"));
    } catch (err) {
      next(err);
    }
  }

  static async deletePaymentById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await PaymentService.deleteById(req.params.id);
      if (!result)
        return res
          .status(404)
          .json(new ApiError(404, "Failed to delete Payment"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
