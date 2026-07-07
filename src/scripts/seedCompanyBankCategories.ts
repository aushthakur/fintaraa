import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  CompanyBankCategory,
  CompanyCategoryLabel,
  CompanyCategoryStatus,
} from "../modals/companyBankCategory.model";

const MASTER_TYPE = "company_bank_category" as const;

const banks = [
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "SBI",
  "Kotak Mahindra Bank",
  "IDFC FIRST Bank",
  "Bank of Baroda",
  "Punjab National Bank",
  "Yes Bank",
  "IndusInd Bank",
  "Federal Bank",
  "AU Small Finance Bank",
];

const companies = [
  "Tata Consultancy Services",
  "Infosys",
  "Wipro",
  "HCLTech",
  "Tech Mahindra",
  "LTIMindtree",
  "Mphasis",
  "Persistent Systems",
  "Coforge",
  "Oracle India",
  "Microsoft India",
  "Google India",
  "Amazon Development Centre India",
  "Adobe India",
  "IBM India",
  "Accenture India",
  "Capgemini India",
  "Cognizant Technology Solutions",
  "Deloitte India",
  "KPMG India",
  "EY India",
  "PwC India",
  "Genpact",
  "Concentrix",
  "Teleperformance India",
  "Hinduja Global Solutions",
  "WNS Global Services",
  "EXL Service",
  "Firstsource Solutions",
  "Tata Motors",
  "Maruti Suzuki India",
  "Mahindra & Mahindra",
  "Hero MotoCorp",
  "Bajaj Auto",
  "TVS Motor Company",
  "Ashok Leyland",
  "Hyundai Motor India",
  "Honda Cars India",
  "Toyota Kirloskar Motor",
  "Reliance Industries",
  "Reliance Retail",
  "Jio Platforms",
  "Adani Enterprises",
  "Adani Ports and SEZ",
  "Adani Green Energy",
  "Larsen & Toubro",
  "UltraTech Cement",
  "Grasim Industries",
  "JSW Steel",
  "Tata Steel",
  "Hindalco Industries",
  "Vedanta",
  "Hindustan Zinc",
  "NTPC",
  "Power Grid Corporation",
  "Tata Power",
  "Coal India",
  "ONGC",
  "Indian Oil Corporation",
  "Bharat Petroleum Corporation",
  "Hindustan Petroleum Corporation",
  "GAIL India",
  "Oil India",
  "HDFC Life Insurance",
  "ICICI Prudential Life Insurance",
  "SBI Life Insurance",
  "Bajaj Finance",
  "Bajaj Finserv",
  "Muthoot Finance",
  "Manappuram Finance",
  "Cholamandalam Investment and Finance",
  "Shriram Finance",
  "HDFC AMC",
  "SBI Cards and Payment Services",
  "Paytm",
  "PhonePe",
  "Razorpay",
  "Pine Labs",
  "Zerodha",
  "Groww",
  "Swiggy",
  "Zomato",
  "Flipkart",
  "Myntra",
  "Meesho",
  "BigBasket",
  "Blinkit",
  "Nykaa",
  "Delhivery",
  "Blue Dart Express",
  "DTDC Express",
  "Ecom Express",
  "Mahindra Logistics",
  "InterGlobe Aviation",
  "Air India",
  "Vistara",
  "SpiceJet",
  "MakeMyTrip",
  "EaseMyTrip",
  "OYO Rooms",
  "Indian Hotels Company",
  "EIH Limited",
  "ITC Hotels",
  "Apollo Hospitals",
  "Fortis Healthcare",
  "Max Healthcare",
  "Narayana Health",
  "Dr Lal PathLabs",
  "Metropolis Healthcare",
  "Sun Pharmaceutical Industries",
  "Cipla",
  "Dr Reddy's Laboratories",
  "Lupin",
  "Aurobindo Pharma",
  "Biocon",
  "Divi's Laboratories",
  "Torrent Pharmaceuticals",
  "Alkem Laboratories",
  "Dabur India",
  "Marico",
  "Godrej Consumer Products",
  "Hindustan Unilever",
  "Nestle India",
  "Britannia Industries",
  "ITC Limited",
  "Varun Beverages",
  "United Spirits",
  "Asian Paints",
  "Berger Paints India",
  "Pidilite Industries",
  "Titan Company",
  "Trent",
  "DMart",
  "Avenue Supermarts",
  "Shoppers Stop",
  "Landmark Group India",
  "Bharti Airtel",
  "Vodafone Idea",
  "Tata Communications",
  "Indus Towers",
  "Info Edge India",
  "Naukri",
  "Policybazaar",
  "CarDekho",
  "Cars24",
  "Urban Company",
  "Lenskart",
  "Byju's",
  "Unacademy",
  "Vedantu",
  "upGrad",
  "PhysicsWallah",
  "Ola Electric",
  "Ather Energy",
  "Tata Electronics",
  "Foxconn India",
  "Dixon Technologies",
  "Havells India",
  "Polycab India",
  "Voltas",
  "Blue Star",
  "Page Industries",
];

const normalizeKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const slugifyKey = (value: string) => value.replace(/\s+/g, "-");

const buildCategories = (index: number): CompanyCategoryLabel[] => {
  if (index < 55) return ["CAT A"];
  if (index < 95) return ["CAT B"];
  if (index < 125) return ["CAT C"];
  if (index % 3 === 0) return ["CAT A", "CAT B"];
  if (index % 3 === 1) return ["CAT B", "CAT C"];
  return ["CAT A", "CAT C"];
};

const buildAliases = (companyName: string) => {
  const aliases = new Set<string>();
  aliases.add(companyName.replace(/\bIndia\b/gi, "").trim());
  aliases.add(companyName.replace(/\bLimited\b/gi, "Ltd").trim());
  aliases.add(companyName.replace(/\bTechnologies\b/gi, "Tech").trim());
  const acronym = companyName
    .replace(/&/g, "and")
    .split(/\s+/)
    .filter((word) => !["and", "of", "the"].includes(word.toLowerCase()))
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  if (acronym.length >= 2) aliases.add(acronym);
  return Array.from(aliases).filter(
    (alias) => alias && alias !== companyName,
  );
};

const seed = async () => {
  try {
    await connectDB();

    const operations = companies.slice(0, 150).map((companyName, index) => {
      const bankName = banks[index % banks.length];
      const companyKey = normalizeKey(companyName);
      const bankKey = normalizeKey(bankName);

      return {
        updateOne: {
          filter: { masterType: MASTER_TYPE, companyKey, bankKey },
          update: {
            $set: {
              masterType: MASTER_TYPE,
              slug: `company-bank-category-${slugifyKey(companyKey)}-${slugifyKey(bankKey)}`,
              companyName,
              companyKey,
              bankName,
              bankKey,
              categories: buildCategories(index),
              aliases: buildAliases(companyName),
              remarks: "Fintaraa company category seed",
              status: CompanyCategoryStatus.ACTIVE,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await CompanyBankCategory.bulkWrite(operations, {
      ordered: false,
    });

    console.log(
      `Seeded company-bank categories. Inserted: ${result.upsertedCount}, updated: ${result.modifiedCount}.`,
    );
  } catch (error) {
    console.error("Company category seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
