import { differenceInCalendarDays, addDays } from "date-fns";
import mongoose, { Document, Schema, Model, Types } from "mongoose";

export type PricingTarget = "room" | "property";
export enum Currency { USD = "USD", INR = "INR", EUR = "EUR", GBP = "GBP" }
export enum PriceUnit { NIGHT = "night", WEEK = "week", MONTH = "month" }

export interface ISeasonalPricing {
  name: string;
  endDate: Date;
  startDate: Date;
  isActive: boolean;
  priceMultiplier: number; // e.g., 1.2 -> +20%
}

export interface IAdditionalFee {
  key: string;
  name: string;
  amount: number;
  isActive: boolean;
  isRequired: boolean;
}

export interface IDynamicRule {
  key: string;
  payload: any;
  priority?: number;
  isActive?: boolean;
  type: "min_stay_override" | "guest_surcharge" | "date_override" | "percentage_discount";
}

export interface IPricing extends Document {
  target: PricingTarget;
  roomId?: Types.ObjectId;
  propertyId?: Types.ObjectId;

  basePrice: number; // pricePerUnit
  currency: Currency;
  priceUnit: PriceUnit; // NIGHT / WEEK / MONTH

  basePricePerNight: number;

  cleaningFee: number;
  additionalFees: IAdditionalFee[];

  seasonalPricing: ISeasonalPricing[]; // non-overlapping

  maxGuests: number;
  minimumStay: number;
  maximumStay?: number;
  extraGuestChargePerGuestPerNight?: number;

  dynamicRules?: IDynamicRule[];

  currentPrice?: {
    date: Date;
    breakdown?: any;
    pricePerNight: number;
  };
  lastPriceUpdatedAt?: Date;

  getPriceForDate(date: Date, guests?: number): { pricePerNight: number; breakdown: any };
  calculateTotalPrice(startDate: Date, endDate: Date, guests?: number): { breakdown: any; totalPrice: number };
}

interface PricingModel extends Model<IPricing> {
  recalcAndUpdateAll(currentDate?: Date): Promise<number>;
}

const seasonalSchema = new Schema<ISeasonalPricing>({
  name: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator(this: ISeasonalPricing, v: Date) { return v > this.startDate; },
      message: "season endDate must be after startDate",
    },
  },
  priceMultiplier: { type: Number, required: true, min: 0.01, max: 10, default: 1 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const additionalFeeSchema = new Schema<IAdditionalFee>({
  key: { type: String, required: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  isRequired: { type: Boolean, default: false },
  amount: { type: Number, required: true, min: 0 },
}, { _id: false });

const dynamicRuleSchema = new Schema<IDynamicRule>({
  key: { type: String, required: true },
  type: { type: String, required: true },
  payload: { type: Schema.Types.Mixed },
  priority: { type: Number, default: 10 },
  isActive: { type: Boolean, default: true },
}, { _id: false });

const pricingSchema = new Schema<IPricing>({
  roomId: { type: Schema.Types.ObjectId, ref: "Room", index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", index: true },
  target: { type: String, enum: ["room", "property"], required: true, index: true },

  basePricePerNight: { type: Number, default: 0 },
  basePrice: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: Object.values(Currency), default: Currency.INR },
  priceUnit: { type: String, enum: Object.values(PriceUnit), default: PriceUnit.NIGHT },

  additionalFees: [additionalFeeSchema],
  cleaningFee: { type: Number, default: 0, min: 0 },

  seasonalPricing: [seasonalSchema],

  maximumStay: { type: Number },
  maxGuests: { type: Number, default: 1, min: 1 },
  minimumStay: { type: Number, default: 1, min: 1 },
  extraGuestChargePerGuestPerNight: { type: Number, default: 0 },

  dynamicRules: [dynamicRuleSchema],

  currentPrice: {
    date: Date,
    pricePerNight: Number,
    breakdown: Schema.Types.Mixed,
  },
  lastPriceUpdatedAt: Date,

}, { timestamps: true });

/**
 * Pre-save: compute basePricePerNight from basePrice + priceUnit
 * and validate no overlapping seasonal ranges
 */
pricingSchema.pre<IPricing>("validate", function (next) {
  // compute basePricePerNight
  const conv = (unit: PriceUnit, base: number) => {
    switch (unit) {
      case PriceUnit.WEEK: return base / 7;
      case PriceUnit.MONTH: return base / 30; // approximate month -> 30 days
      default: return base; // night
    }
  };
  this.basePricePerNight = conv(this.priceUnit as PriceUnit, this.basePrice);

  // validate overlapping seasons
  const seasons = (this.seasonalPricing || []).filter(s => s.isActive).map(s => ({ start: s.startDate.getTime(), end: s.endDate.getTime(), name: s.name }));
  seasons.sort((a, b) => a.start - b.start);
  for (let i = 1; i < seasons.length; i++) {
    if (seasons[i].start <= seasons[i - 1].end) {
      return next(new Error(`Season ranges overlap: "${seasons[i].name}" overlaps previous season.`));
    }
  }
  next();
});

/**
 * Get price for a single date: applies seasonal multiplier and extra-guest surcharge
 */
pricingSchema.methods.getPriceForDate = function (date: Date, guests: number = 1) {
  const base = this.basePricePerNight;
  let multiplier = 1;
  let appliedSeason: any = null;
  if (Array.isArray(this.seasonalPricing)) {
    for (const s of this.seasonalPricing) {
      if (s.isActive && date >= s.startDate && date <= s.endDate) {
        multiplier = s.priceMultiplier;
        appliedSeason = s;
        break;
      }
    }
  }
  const priceAfterSeason = base * multiplier;
  let extraGuestChargeTotal = 0;
  if (guests > this.maxGuests && this.extraGuestChargePerGuestPerNight) {
    const extra = guests - this.maxGuests;
    extraGuestChargeTotal = extra * this.extraGuestChargePerGuestPerNight;
  }
  const perNight = Math.max(0, priceAfterSeason + extraGuestChargeTotal);
  const breakdown = {
    date,
    base,
    multiplier,
    appliedSeason,
    extraGuestChargePerNight: extraGuestChargeTotal,
    perNight,
  };
  return { pricePerNight: perNight, breakdown };
};

/**
 * Calculate total price across date range (handles multi-season spans by computing day-by-day)
 */
pricingSchema.methods.calculateTotalPrice = function (startDate: Date, endDate: Date, guests: number = 1) {
  const nights = differenceInCalendarDays(endDate, startDate);
  if (nights <= 0) throw new Error("Invalid booking duration (endDate must be after startDate)");
  const breakdown: any = {
    nights,
    perNightDetails: [],
    cleaningFee: this.cleaningFee,
    securityDeposit: this.securityDeposit,
    additionalFees: 0,
    subtotal: 0,
    totalPrice: 0,
  };

  let subtotal = 0;
  for (let i = 0; i < nights; i++) {
    const day = addDays(startDate, i);
    const { pricePerNight, breakdown: dayBreak } = this.getPriceForDate(day, guests);
    breakdown.perNightDetails.push(dayBreak);
    subtotal += pricePerNight;
  }

  const totalAdditionalFees = (this.additionalFees || []).filter((f: any) => f.isActive).reduce((s: number, f: any) => s + f.amount, 0);
  breakdown.additionalFees = totalAdditionalFees;
  breakdown.subtotal = subtotal;
  breakdown.totalPrice = Math.max(0, subtotal + this.cleaningFee + this.securityDeposit + totalAdditionalFees);

  return { breakdown, totalPrice: breakdown.totalPrice };
};

/**
 * Static: recalc price for all pricing docs and update currentPrice
 * Use as part of daily cron to precompute the price shown on site for `today`
 */
pricingSchema.statics.recalcAndUpdateAll = async function (currentDate: Date = new Date()) {
  const Pricing = this as PricingModel;
  // fetch only active pricing docs
  const cursor = Pricing.find({ isActive: { $ne: false } }).cursor();
  let updated = 0;
  for await (const doc of cursor) {
    try {
      const { pricePerNight, breakdown } = doc.getPriceForDate(currentDate);
      doc.currentPrice = { date: currentDate, pricePerNight, breakdown };
      doc.lastPriceUpdatedAt = new Date();
      await doc.save();
      updated++;
    } catch (err) {
      console.log("pricing recalc error for doc:", doc._id, err);
      // continue with others
    }
  }
  return updated;
};

export const Pricing = mongoose.models.Pricing as PricingModel || mongoose.model<IPricing, PricingModel>("Pricing", pricingSchema);
export default Pricing;
