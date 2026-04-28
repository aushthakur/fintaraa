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
  "salaried",
  "self_employed",
  "self_employed_professional",
  "self_employed_non_professional",
];

const propertyTypes = ["Residential", "Commercial", "NA"];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const buildSeed = (idx: number) => {
  const salaryType = pick(salaryTypes);
  const minIncome = salaryType === "salaried" ? 30000 : 50000;
  const maxIncome = salaryType === "salaried" ? 120000 : 250000;
  const grossIncome = rand(minIncome, maxIncome);
  const netIncome = Math.round(grossIncome * 0.85);
  const loanAmount = rand(200000, 2500000);
  const tenure = rand(12, 84);
  const roi = Number((rand(10, 24) + Math.random()).toFixed(2));
  const emi = Math.round(loanAmount / tenure + (loanAmount * roi) / 1200);

  return {
    loanType: loanTypes[idx % loanTypes.length],
    bankName: bankNames[idx % bankNames.length],
    salaryType,
    itrWithFinancial: idx % 2 === 0 ? "Yes" : "No",
    gstProgram: idx % 3 === 0 ? "Yes" : "No",
    selfEmp: salaryType !== "salaried" ? rand(1, 10) : 0,
    salaryEmp: salaryType === "salaried" ? rand(50, 500) : 0,
    cashProfit: rand(20000, 200000),
    lowLtv: rand(60, 90),
    itrYears: rand(1, 3),
    gstYears: rand(1, 2),
    bankingYears: rand(1, 5),
    rentalIncomeType: pick(["Cash", "Mixed", "Banking"]),
    propertyCategory: pick(["CAT A", "CAT B", "CAT C"]),
    programs: [pick(["NIP", "GST", "LTV"])],
    bankAmount: loanAmount,
    bankingSurrogate: idx % 2 === 0 ? "Yes" : "No",
    companyListed: idx % 4 === 0 ? "Yes" : "No",
    foir: rand(30, 60),
    minimumVintage: rand(6, 36),
    businessAge: rand(1, 15),
    grossIncome,
    currentExperience: rand(1, 10),
    totalExperience: rand(2, 20),
    salaryAmount: grossIncome,
    currentTotalEmi: rand(2000, 25000),
    netIncome,
    cibilScoreWithCall: rand(650, 820),
    catAApproved: idx % 3 === 0 ? "Yes" : "No",
    catBSemiApproved: idx % 3 === 1 ? "Yes" : "No",
    catCUnapproved: idx % 3 === 2 ? "Yes" : "No",
    propertyType: pick(propertyTypes),
    empAge: rand(21, 60),
    loanTenure: tenure,
    rateOfInterest: roi,
    emiAmount: emi,
    loginFees: rand(0, 5000),
    processingFees: rand(1000, 15000),
    legalValuation: rand(0, 10000),
    insurance: rand(0, 8000),
    rm: `RM ${idx + 1}`,
    rmMailId: `rm${idx + 1}@fintara.test`,
    rmMbNo: `98${rand(10000000, 99999999)}`,
    asm: `ASM ${idx + 1}`,
    asmMailId: `asm${idx + 1}@fintara.test`,
    asmMbNo: `97${rand(10000000, 99999999)}`,
    zsm: `ZSM ${idx + 1}`,
    zsmMailId: `zsm${idx + 1}@fintara.test`,
    zsmMbNo: `96${rand(10000000, 99999999)}`,
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
