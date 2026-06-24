import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  EligibilityCriteria,
  EligibilityCriteriaStatus,
} from "../modals/eligibilityCriteria.model";

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

const coreLoanTypes = [
  "personalLoan",
  "renovationLoan",
  "businessLoan",
  "educationLoan",
];

const primarySalaryTypes = ["Salaried", "Self Employed"];
const extraProfessionalLoanTypes = ["personalLoan", "businessLoan"];

const loanConfig: Record<
  string,
  { baseAmount: number; tenure: number; minRoi: number; amountStep: number }
> = {
  personalLoan: {
    baseAmount: 2500000,
    tenure: 5,
    minRoi: 10.49,
    amountStep: 125000,
  },
  renovationLoan: {
    baseAmount: 3000000,
    tenure: 7,
    minRoi: 10.75,
    amountStep: 150000,
  },
  businessLoan: {
    baseAmount: 6000000,
    tenure: 6,
    minRoi: 11.25,
    amountStep: 250000,
  },
  educationLoan: {
    baseAmount: 4500000,
    tenure: 10,
    minRoi: 8.45,
    amountStep: 175000,
  },
};

const bankRateOffset: Record<string, number> = {
  "HDFC Bank": 0.1,
  "ICICI Bank": 0.2,
  "Axis Bank": 0.35,
  SBI: 0,
  "Kotak Mahindra Bank": 0.45,
  "IDFC FIRST Bank": 0.25,
  "Bank of Baroda": 0.15,
  PNB: 0.3,
  "Yes Bank": 0.55,
  "IndusInd Bank": 0.5,
};

type SeedProfile = {
  loanType: string;
  bankName: string;
  salaryType: string;
};

const seedProfiles: SeedProfile[] = [
  ...coreLoanTypes.flatMap((loanType) =>
    bankNames.flatMap((bankName) =>
      primarySalaryTypes.map((salaryType) => ({
        loanType,
        bankName,
        salaryType,
      })),
    ),
  ),
  ...extraProfessionalLoanTypes.flatMap((loanType) =>
    bankNames.map((bankName) => ({
      loanType,
      bankName,
      salaryType: "Self Employed Professional",
    })),
  ),
];

const salaryTypeIndex = (salaryType: string) =>
  salaryType === "Salaried"
    ? 0
    : salaryType === "Self Employed"
      ? 1
      : 2;

const buildSeed = (profile: SeedProfile, idx: number) => {
  const { loanType, bankName, salaryType } = profile;
  const config = loanConfig[loanType];
  const bankIndex = bankNames.indexOf(bankName);
  const salaryIndex = salaryTypeIndex(salaryType);
  const loanIndex = coreLoanTypes.indexOf(loanType);
  const companyCategories = ["CAT A", "CAT B", "CAT C"];
  const cibilScore = 660 + ((bankIndex + loanIndex + salaryIndex) % 7) * 10;
  const maximumLoanAmount =
    config.baseAmount + bankIndex * config.amountStep - salaryIndex * 150000;
  const roi = Number(
    (
      config.minRoi +
      (bankRateOffset[bankName] || 0) +
      salaryIndex * 0.35
    ).toFixed(2),
  );
  const netSalary = 35000 + bankIndex * 3500 + loanIndex * 2500;
  const businessAmount = 350000 + bankIndex * 45000 + loanIndex * 65000;

  return {
    loanType,
    bankName,
    salaryType,
    cibilScore,
    itrYears: salaryType === "Salaried" ? 1 : 2 + (loanIndex % 2),
    totalExperience: salaryType === "Salaried" ? 2 + (bankIndex % 5) : undefined,
    totalExperienceMonths:
      salaryType === "Salaried" ? (bankIndex + loanIndex) % 12 : undefined,
    currentExperience:
      salaryType === "Salaried" ? 1 + ((bankIndex + loanIndex) % 4) : undefined,
    netSalary: salaryType === "Salaried" ? netSalary : undefined,
    currentTotalEmi:
      salaryType === "Salaried" ? 5000 + bankIndex * 1500 : undefined,
    companyCategory:
      salaryType === "Salaried"
        ? [companyCategories[(bankIndex + loanIndex) % companyCategories.length]]
        : undefined,
    abb: 25000 + bankIndex * 6500 + loanIndex * 7500,
    maximumLoanAmount,
    totalVintage:
      salaryType !== "Salaried" ? 2 + ((bankIndex + loanIndex) % 7) : undefined,
    currentVintage:
      salaryType !== "Salaried" ? 1 + ((bankIndex + loanIndex) % 5) : undefined,
    businessProgramFresh:
      salaryType !== "Salaried"
        ? (bankIndex + loanIndex) % 2 === 0
          ? "Yes"
          : "No"
        : undefined,
    gstAmount: salaryType === "Self Employed" ? businessAmount : undefined,
    receiptsAmount:
      salaryType === "Self Employed Professional"
        ? businessAmount + 125000
        : undefined,
    bankingAmount:
      salaryType !== "Salaried" ? businessAmount + 50000 : undefined,
    itrAmount: salaryType !== "Salaried" ? businessAmount + 25000 : undefined,
    nipPdBase: salaryType !== "Salaried" ? businessAmount - 50000 : undefined,
    lowLtv: 65 + ((bankIndex + loanIndex) % 5) * 5,
    salaryFoir0To25000: salaryType === "Salaried" ? 35 : undefined,
    salaryFoir25000To50000: salaryType === "Salaried" ? 45 : undefined,
    salaryFoir50000To75000: salaryType === "Salaried" ? 50 : undefined,
    salaryFoir75000Above: salaryType === "Salaried" ? 55 : undefined,
    businessFoir0To600000: salaryType === "Self Employed" ? 45 : undefined,
    businessFoir600000To1000000:
      salaryType === "Self Employed" ? 50 : undefined,
    businessFoir1000000Above:
      salaryType === "Self Employed" ? 55 : undefined,
    itrFoir0To600000:
      salaryType === "Self Employed Professional" ? 50 : undefined,
    itrFoir600000To1000000:
      salaryType === "Self Employed Professional" ? 55 : undefined,
    itrFoir1000000Above:
      salaryType === "Self Employed Professional" ? 60 : undefined,
    btMultiplier0To1Year: salaryType !== "Salaried" ? 1.1 : undefined,
    btMultiplier1To3Years: salaryType !== "Salaried" ? 1.25 : undefined,
    btMultiplier3YearsAbove: salaryType !== "Salaried" ? 1.4 : undefined,
    receiptMultiplier0To1Year:
      salaryType === "Self Employed Professional" ? 1.15 : undefined,
    receiptMultiplier1To3Years:
      salaryType === "Self Employed Professional" ? 1.3 : undefined,
    roi,
    minAge: loanType === "educationLoan" ? 18 : 21,
    maxAge:
      loanType === "educationLoan" ? 35 : salaryType === "Salaried" ? 60 : 65,
    maxTenureYears: config.tenure,
    processingFees: Number(
      (0.5 + salaryIndex * 0.25 + bankIndex * 0.03).toFixed(2),
    ),
    insurance:
      loanType === "educationLoan" || loanType === "renovationLoan"
        ? "As per lender policy"
        : "Optional",
    loginFees: bankIndex % 3 === 0 ? "Nil" : `Rs ${999 + bankIndex * 250}`,
    cashRental:
      loanType === "renovationLoan" ? "Accepted for owned property" : undefined,
    bankRental:
      loanType === "renovationLoan" ? "Preferred for assessment" : undefined,
    residentialCatALtv: loanType === "renovationLoan" ? 80 : undefined,
    commercialCatALtv: loanType === "renovationLoan" ? 70 : undefined,
    rm: `${bankName} Relationship Desk`,
    rmMailId: `eligibility.${idx + 1}@fintara.test`,
    zsm: `${bankName} Zonal Desk`,
    zsmMailId: `zonal.${idx + 1}@fintara.test`,
    remarks: `Fintaraa eligibility seed ${idx + 1}`,
    status: EligibilityCriteriaStatus.ACTIVE,
  };
};

const seed = async () => {
  try {
    await connectDB();

    const payload = seedProfiles
      .slice(0, 100)
      .map((profile, idx) => buildSeed(profile, idx));

    await EligibilityCriteria.deleteMany({
      $or: [
        { remarks: /^Fintaraa eligibility seed / },
        { rmMailId: /^rm\d+@fintara\.test$/ },
      ],
    });
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
