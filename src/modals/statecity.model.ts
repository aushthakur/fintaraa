import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * ==============================
 * 🌍 Country Schema & Interface
 * ==============================
 */
export interface ICountry extends Document {
  name: string;
  code: string;
}

const CountrySchema: Schema<ICountry> = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, required: true, trim: true, uppercase: true }, // e.g., "IN", "US"
  },
  { timestamps: true }
);

const Country: Model<ICountry> = mongoose.model<ICountry>("Country", CountrySchema);

/**
 * ===========================
 * 📍 State Schema & Interface
 * ===========================
 */
export interface IState extends Document {
  name: string;
  code: string;
  countryId: mongoose.Types.ObjectId;
}

const StateSchema: Schema<IState> = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    countryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true,
    },
  },
  { timestamps: true }
);

const State: Model<IState> = mongoose.model<IState>("State", StateSchema);

/**
 * ==========================
 * 🏙️ City Schema & Interface
 * ==========================
 */
export interface ICity extends Document {
  name: string;
  isCapital?: boolean;
  stateId: mongoose.Types.ObjectId;
  countryId: mongoose.Types.ObjectId;
}

const CitySchema: Schema<ICity> = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: true,
    },
    countryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true,
    },
    isCapital: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const City: Model<ICity> = mongoose.model<ICity>("City", CitySchema);

export { State, City, Country };
