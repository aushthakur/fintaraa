import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  EligibilityCriteria,
  EligibilityCriteriaStatus,
} from "../modals/eligibilityCriteria.model";

const loanTypes = [
  "balanceTransferLoan",
  "topUpLoan",
  "twoWheelerLoan",
  "usedCarLoan",
  "agricultureLoan",
  "personalLoan",
  "homeLoan",
  "businessLoan",
  "vehicleLoan",
  "renovationLoan",
  "workingCapitalLoan",
  "loanAgainstProperty",
  "loanAgainstSecurity",
  "loanAgainstCarValue",
  "goldLoan",
  "educationLoan",
];

const bankNames = [
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "SBI",
  "Kotak Mahindra Bank",
  "IDFC FIRST Bank",
  "Bank of Baroda",
  "PNB",
  "Yes Bank",
  "IndusInd Bank",
];

const salaryTypes = [
  "Salaried",
  "Self Employed",
  "Self Employed Professional",
];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const buildSeed = (idx: number) => {
  const salaryType = pick(salaryTypes);
  const minIncome = salaryType === "Salaried" ? 30000 : 50000;
  const maxIncome = salaryType === "Salaried" ? 120000 : 250000;
  const grossIncome = rand(minIncome, maxIncome);
  const netIncome = Math.round(grossIncome * 0.85);
  const companyCategories = ["CAT A", "CAT B", "CAT C"];

  return {
    loanType: loanTypes[idx % loanTypes.length],
    bankName: bankNames[idx % bankNames.length],
    salaryType,
    cibilScore: rand(650, 820),
    itrYears: rand(1, 3),
    totalExperience: salaryType === "Salaried" ? rand(2, 20) : undefined,
    netSalary: salaryType === "Salaried" ? netIncome : undefined,
    currentTotalEmi: salaryType === "Salaried" ? rand(2000, 25000) : undefined,
    companyCategory:
      salaryType === "Salaried" ? [pick(companyCategories)] : undefined,
    abb: rand(10000, 150000),
    maximumLoanAmount:
      salaryType === "Salaried" ? rand(100000, 2500000) : undefined,
    totalVintage: salaryType !== "Salaried" ? rand(1, 15) : undefined,
    currentVintage: salaryType !== "Salaried" ? rand(1, 10) : undefined,
    businessProgramFresh: salaryType !== "Salaried" ? pick(["Yes", "No"]) : undefined,
    gstAmount: salaryType === "Self Employed" ? rand(50000, 500000) : undefined,
    receiptsAmount:
      salaryType === "Self Employed Professional"
        ? rand(50000, 500000)
        : undefined,
    bankingAmount: salaryType !== "Salaried" ? rand(50000, 500000) : undefined,
    itrAmount: salaryType !== "Salaried" ? rand(50000, 500000) : undefined,
    nipPdBase: salaryType !== "Salaried" ? rand(50000, 500000) : undefined,
    lowLtv: rand(60, 90),
    rm: `RM ${idx + 1}`,
    rmMailId: `rm${idx + 1}@fintara.test`,
    zsm: `ZSM ${idx + 1}`,
    zsmMailId: `zsm${idx + 1}@fintara.test`,
    status:
      idx % 4 === 0
        ? EligibilityCriteriaStatus.INACTIVE
        : EligibilityCriteriaStatus.ACTIVE,
  };
};

const seed = async () => {
  try {
    await connectDB();

    const payload = Array.from({ length: 10 }).map((_, idx) =>
      buildSeed(idx)
    );

    await EligibilityCriteria.insertMany(payload);
    console.log(`Seeded ${payload.length} eligibility criteria records.`);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
