import ApiError from "../../utils/ApiError";
import { Room } from "../../modals/room.model";
import Pricing from "../../modals/pricing.model";
import ApiResponse from "../../utils/ApiResponse";
import { Coupon } from "../../modals/coupon.model";
import { Booking } from "../../modals/booking.model";
import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import mongoose from "mongoose";

const BookingService = new CommonService(Booking);

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const normalizeDate = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const calcNights = (checkIn?: Date, checkOut?: Date): number => {
  if (!checkIn || !checkOut) return 1;
  const end = normalizeDate(checkOut);
  const start = normalizeDate(checkIn);
  const diffDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
  return Math.max(1, diffDays);
};

export class BookingController {
  static async createBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        roomId,
        guests,
        checkInDate,
        contactInfo,
        checkOutDate,
        numberOfRooms,
        appliedCoupon,
        ...rest
      } = req.body;

      // ✅ Check if bookingId is provided
      if (req.body.bookingId) {
        const existingBooking = await Booking.findOne({
          _id: req.body.bookingId,
          status: "pending",
          paymentStatus: "pending",
        });
        if (existingBooking) {
          return res
            .status(200)
            .json(new ApiResponse(200, existingBooking, "Existing pending booking found"));
        }
      }

      // ✅ Check room exists
      const room = await Room.findById(roomId);
      if (!room) return res.status(404).json(new ApiError(404, "Room not found"));

      // ✅ Get pricing config
      const pricing = await Pricing.findOne({ roomId, propertyId: room.property });
      if (!pricing) return res.status(404).json(new ApiError(404, "Pricing not found for this room"));

      const nights = calcNights(checkInDate, checkOutDate);
      if (nights <= 0) return res.status(400).json(new ApiError(400, "Invalid check-in/check-out dates"));

      // ✅ Guest & room checks
      const totalGuests =
        (guests?.adults || 0) + (guests?.children || 0) + (guests?.infants || 0);

      const maxAllowedGuests = pricing.maxGuests * numberOfRooms;

      if (totalGuests > maxAllowedGuests) {
        return res.status(400).json(
          new ApiError(
            400,
            `Your selection exceeds the room capacity. For ${numberOfRooms} room(s), you can host up to ${maxAllowedGuests} guests.`
          )
        );
      }

      // ✅ Price calculations
      const basePrice = (pricing.currentPrice?.pricePerNight || pricing.basePrice) * nights * numberOfRooms;

      const cleaningFee = (pricing.cleaningFee || 0) * numberOfRooms;
      const additionalCost = room?.additionalCost || 0;
      const serviceFee = additionalCost ? additionalCost : Math.round(basePrice * 0.1);

      // Extra guest charges
      let extraGuestCharges = 0;
      if (totalGuests > maxAllowedGuests) {
        const extra = totalGuests - pricing.maxGuests;
        extraGuestCharges =
          extra * (pricing.extraGuestChargePerGuestPerNight || 0) * nights;
      }

      // ✅ Apply coupon/discount
      let discounts = 0;
      let couponId: any = "";
      if (appliedCoupon) {
        const coupon = await Coupon.findOne({ code: appliedCoupon, status: "active" });
        if (coupon) {
          couponId = coupon?._id;
          if (coupon.type === "flat") {
            discounts = Math.min(coupon.discountValue, basePrice);
          } else if (coupon.type === "percentage") {
            discounts = Math.min(
              (coupon.discountValue / 100) * basePrice,
              coupon.maxDiscountAmount || Infinity
            );
          }
        }
      }
      const totalAmount =
        basePrice + cleaningFee + serviceFee + extraGuestCharges - discounts;

      const { _id: guestId } = (req as any).user;

      // ✅ Check for existing pending/unpaid booking for same user + room
      const existingBooking = await Booking.findOne({
        roomId,
        guestId,
        status: { $in: ["pending"] },
        paymentStatus: { $in: ["pending"] }
      });

      const bookingData: any = {
        roomId,
        guestId,
        ...rest,
        checkInDate,
        contactInfo,
        checkOutDate,
        numberOfRooms,
        numberOfGuests: guests,
        propertyId: room.property,
        totalAmount: parseFloat(totalAmount.toFixed(1)),
        priceBreakdown: {
          nights,
          discounts,
          basePrice: parseFloat(basePrice.toFixed(1)),
          serviceFee: parseFloat(serviceFee.toFixed(1)),
          cleaningFee: parseFloat(cleaningFee.toFixed(1)),
          extraGuestCharges: parseFloat(extraGuestCharges.toFixed(1)),
        },
      };

      // ✅ Add coupon-related fields only if present
      if (appliedCoupon) {
        bookingData.appliedCoupon = appliedCoupon;
        if (couponId) bookingData.couponId = couponId;
      }

      let updateQuery: any = { $set: bookingData };
      if (!appliedCoupon && existingBooking?.couponId) updateQuery.$unset = { appliedCoupon: "", couponId: "" };

      let result;
      if (existingBooking) {
        result = await Booking.findByIdAndUpdate(
          existingBooking._id,
          updateQuery,
          { new: true }
        );
      } else result = await BookingService.create(bookingData);

      return res
        .status(201)
        .json(new ApiResponse(201, result, "Booking created successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const { bookingId } = req.body;
      if (!bookingId) {
        return res.status(400).json(new ApiError(400, "Booking ID is required"));
      }

      const booking: any = await Booking.findById(bookingId)
        .populate("guestId", "name email mobile addresses")
        .populate("roomId", "title")
        .lean();

      if (!booking) {
        return res.status(404).json(new ApiError(404, "Booking not found"));
      }

      if (booking.status !== "pending" || booking.paymentStatus !== "pending") {
        return res.status(400).json(
          new ApiError(
            400,
            `Booking cannot be processed. Current status: ${booking.status}, paymentStatus: ${booking.paymentStatus}`
          )
        );
      }

      const payload = {
        currency: "KES",
        billingCountry: "KE",
        amount: booking.totalAmount,
        notificationId: req.body.ipnId,
        orderId: booking._id.toString(),
        address: booking.guestId?.addresses?.[0],
        customerEmail: booking.guestId?.email || "",
        customerPhone: booking.guestId?.mobile || "",
        customerName: booking.guestId?.name || "Guest",
        description: `Payment for booking ${booking._id}`,
      };
      (req as any).body = payload;
      return next();
    } catch (err) {
      return next(err);
    }
  }

  // ✅ Get All Bookings (with filters)
  static async getAllBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const { role, _id: userId } = (req as any).user;
      let query: any = { ...req.query };
      if (role !== "admin") query.guestId = new mongoose.Types.ObjectId(userId);

      const pipeline = [
        {
          $lookup: {
            from: "rooms",
            localField: "roomId",
            foreignField: "_id",
            as: "roomId",
          },
        },
        { $unwind: { path: "$roomId", preserveNullAndEmptyArrays: true } },

        {
          $lookup: {
            from: "properties",
            localField: "propertyId",
            foreignField: "_id",
            as: "propertyId",
          },
        },
        { $unwind: { path: "$propertyId", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "galleryitems",
            let: { roomId: "$roomId._id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$roomId", "$$roomId"] } } },
              { $match: { type: "image" } }, // only images
              { $sort: { order: 1, createdAt: -1 } },
              { $project: { url: 1, _id: 0 } },
            ],
            as: "roomImages",
          },
        },
        {
          $lookup: {
            from: "galleryitems",
            let: { propertyId: "$propertyId._id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$propertyId", "$$propertyId"] } } },
              { $match: { type: "image" } }, // only images
              { $sort: { order: 1, createdAt: -1 } },
              { $project: { url: 1, _id: 0 } },
            ],
            as: "propertyImages",
          },
        },
      ];

      const result = await BookingService.getAll(query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Bookings fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  // ✅ Get Booking by ID
  static async getBookingById(req: Request, res: Response, next: NextFunction) {
    try {
      const { role, id: userId } = (req as any).user;
      const result = await BookingService.getById(req.params.id);
      if (!result)
        return res.status(404).json(new ApiError(404, "Booking not found"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Booking fetched successfully"));
    } catch (err) {
      next(err);
    }
  }

  // ✅ Update Booking
  static async updateBookingById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role, id: userId } = (req as any).user;

      const booking = await BookingService.getById(req.params.id);
      if (!booking)
        return res.status(404).json(new ApiError(404, "Booking not found"));

      // Non-admins can only update their own booking
      if (role !== "admin" && booking.guestId.toString() !== userId.toString()) {
        return res.status(403).json(new ApiError(403, "Access denied"));
      }

      const result = await BookingService.updateById(req.params.id, req.body);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to update Booking"));

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Booking updated successfully"));
    } catch (err) {
      next(err);
    }
  }

  // ✅ Delete Booking
  static async deleteBookingById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { role, id: userId } = (req as any).user;

      const booking = await BookingService.getById(req.params.id);
      if (!booking)
        return res.status(404).json(new ApiError(404, "Booking not found"));

      // Non-admins can only delete their own booking
      if (role !== "admin" && booking.guestId.toString() !== userId.toString()) {
        return res.status(403).json(new ApiError(403, "Access denied"));
      }

      const result = await BookingService.deleteById(req.params.id);
      if (!result)
        return res
          .status(400)
          .json(new ApiError(400, "Failed to delete Booking"));

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Booking deleted successfully"));
    } catch (err) {
      next(err);
    }
  }
}
