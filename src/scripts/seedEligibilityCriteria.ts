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

const homeLoanPropertySeeds = [
  {
    bankName: "ICICI Bank",
    salaryType: "Salaried",
    cibilScore: 700,
    itrYears: 1,
    totalExperience: 2,
    totalExperienceMonths: 0,
    currentExperience: 1,
    netSalary: 45000,
    currentTotalEmi: 0,
    companyCategory: ["CAT A"],
    abb: [10, 15, 20],
    maximumLoanAmount: 8500000,
    salaryFoir0To25000: 50,
    salaryFoir25000To50000: 65,
    salaryFoir50000To75000: 70,
    salaryFoir75000Above: 75,
    roi: 8.45,
    processingFees: 0.35,
    loginFees: "Rs 2,999",
    rm: "ICICI Bank Home Loan Desk",
  },
  {
    bankName: "HDFC Bank",
    salaryType: "Salaried",
    cibilScore: 720,
    itrYears: 1,
    totalExperience: 2,
    totalExperienceMonths: 6,
    currentExperience: 1,
    netSalary: 50000,
    currentTotalEmi: 0,
    companyCategory: ["CAT A", "CAT B"],
    abb: [5, 10, 15],
    maximumLoanAmount: 9000000,
    salaryFoir0To25000: 50,
    salaryFoir25000To50000: 65,
    salaryFoir50000To75000: 70,
    salaryFoir75000Above: 75,
    roi: 8.5,
    processingFees: 0.4,
    loginFees: "Rs 3,000",
    rm: "HDFC Bank Home Loan Desk",
  },
  {
    bankName: "SBI",
    salaryType: "Salaried",
    cibilScore: 690,
    itrYears: 1,
    totalExperience: 1,
    totalExperienceMonths: 6,
    currentExperience: 1,
    netSalary: 40000,
    currentTotalEmi: 0,
    companyCategory: ["CAT A", "CAT C"],
    abb: [7, 14, 21],
    maximumLoanAmount: 8000000,
    salaryFoir0To25000: 50,
    salaryFoir25000To50000: 64,
    salaryFoir50000To75000: 69,
    salaryFoir75000Above: 74,
    roi: 8.4,
    processingFees: 0.3,
    loginFees: "Nil",
    rm: "SBI Home Loan Desk",
  },
  {
    bankName: "Axis Bank",
    salaryType: "Salaried",
    cibilScore: 710,
    itrYears: 2,
    totalExperience: 3,
    totalExperienceMonths: 0,
    currentExperience: 1,
    netSalary: 55000,
    currentTotalEmi: 0,
    companyCategory: ["CAT B"],
    abb: [10, 20, 30],
    maximumLoanAmount: 9500000,
    salaryFoir0To25000: 48,
    salaryFoir25000To50000: 63,
    salaryFoir50000To75000: 70,
    salaryFoir75000Above: 75,
    roi: 8.65,
    processingFees: 0.45,
    loginFees: "Rs 3,500",
    rm: "Axis Bank Home Loan Desk",
  },
  {
    bankName: "Kotak Mahindra Bank",
    salaryType: "Self Employed",
    cibilScore: 710,
    itrYears: 2,
    totalVintage: 3,
    businessProgramFresh: "Yes",
    gstAmount: 1800000,
    abb: [10, 15, 25],
    bankingAmount: 2200000,
    itrAmount: 2000000,
    nipPdBase: 1700000,
    lowLtvMin: 55,
    lowLtvMax: 80,
    maximumLoanAmount: 12500000,
    businessFoir0To600000: 55,
    businessFoir600000To1000000: 60,
    businessFoir1000000Above: 65,
    btMultiplier0To1Year: 1.2,
    btMultiplier1To3Years: 1.35,
    btMultiplier3YearsAbove: 1.5,
    roi: 9.1,
    processingFees: 0.6,
    loginFees: "Rs 4,999",
    rm: "Kotak Mahindra Bank Home Loan Desk",
  },
  {
    bankName: "Bank of Baroda",
    salaryType: "Self Employed",
    cibilScore: 690,
    itrYears: 2,
    totalVintage: 2,
    businessProgramFresh: "Yes",
    gstAmount: 1500000,
    abb: [7, 15, 30],
    bankingAmount: 1900000,
    itrAmount: 1750000,
    nipPdBase: 1450000,
    lowLtvMin: 50,
    lowLtvMax: 80,
    maximumLoanAmount: 11000000,
    businessFoir0To600000: 55,
    businessFoir600000To1000000: 60,
    businessFoir1000000Above: 65,
    btMultiplier0To1Year: 1.15,
    btMultiplier1To3Years: 1.3,
    btMultiplier3YearsAbove: 1.45,
    roi: 8.75,
    processingFees: 0.45,
    loginFees: "Rs 2,500",
    rm: "Bank of Baroda Home Loan Desk",
  },
  {
    bankName: "PNB",
    salaryType: "Self Employed",
    cibilScore: 700,
    itrYears: 3,
    totalVintage: 4,
    businessProgramFresh: "No",
    gstAmount: 2200000,
    abb: [5, 10, 20],
    bankingAmount: 2600000,
    itrAmount: 2450000,
    nipPdBase: 2100000,
    lowLtvMin: 55,
    lowLtvMax: 75,
    maximumLoanAmount: 13000000,
    businessFoir0To600000: 55,
    businessFoir600000To1000000: 60,
    businessFoir1000000Above: 65,
    btMultiplier0To1Year: 1.2,
    btMultiplier1To3Years: 1.4,
    btMultiplier3YearsAbove: 1.55,
    roi: 8.85,
    processingFees: 0.5,
    loginFees: "Rs 3,000",
    rm: "PNB Home Loan Desk",
  },
  {
    bankName: "IDFC FIRST Bank",
    salaryType: "Self Employed Professional",
    cibilScore: 720,
    itrYears: 2,
    totalVintage: 2,
    businessProgramFresh: "Yes",
    receiptsAmount: 2400000,
    abb: [10, 20, 30],
    bankingAmount: 2600000,
    itrAmount: 2350000,
    nipPdBase: 2100000,
    lowLtvMin: 55,
    lowLtvMax: 80,
    maximumLoanAmount: 14000000,
    itrFoir0To600000: 58,
    itrFoir600000To1000000: 62,
    itrFoir1000000Above: 68,
    btMultiplier0To1Year: 1.2,
    btMultiplier1To3Years: 1.35,
    btMultiplier3YearsAbove: 1.55,
    receiptMultiplier0To1Year: 1.25,
    receiptMultiplier1To3Years: 1.45,
    roi: 9,
    processingFees: 0.65,
    loginFees: "Rs 4,500",
    rm: "IDFC FIRST Bank Home Loan Desk",
  },
  {
    bankName: "Yes Bank",
    salaryType: "Self Employed Professional",
    cibilScore: 730,
    itrYears: 3,
    totalVintage: 3,
    businessProgramFresh: "Yes",
    receiptsAmount: 3000000,
    abb: [5, 15, 25],
    bankingAmount: 3200000,
    itrAmount: 2950000,
    nipPdBase: 2650000,
    lowLtvMin: 55,
    lowLtvMax: 75,
    maximumLoanAmount: 15000000,
    itrFoir0To600000: 58,
    itrFoir600000To1000000: 63,
    itrFoir1000000Above: 68,
    btMultiplier0To1Year: 1.2,
    btMultiplier1To3Years: 1.4,
    btMultiplier3YearsAbove: 1.6,
    receiptMultiplier0To1Year: 1.25,
    receiptMultiplier1To3Years: 1.5,
    roi: 9.25,
    processingFees: 0.75,
    loginFees: "Rs 5,000",
    rm: "Yes Bank Home Loan Desk",
  },
  {
    bankName: "IndusInd Bank",
    salaryType: "Self Employed Professional",
    cibilScore: 710,
    itrYears: 2,
    totalVintage: 2,
    businessProgramFresh: "No",
    receiptsAmount: 2200000,
    abb: [7, 14, 21],
    bankingAmount: 2400000,
    itrAmount: 2150000,
    nipPdBase: 1900000,
    lowLtvMin: 50,
    lowLtvMax: 75,
    maximumLoanAmount: 12000000,
    itrFoir0To600000: 56,
    itrFoir600000To1000000: 61,
    itrFoir1000000Above: 66,
    btMultiplier0To1Year: 1.15,
    btMultiplier1To3Years: 1.35,
    btMultiplier3YearsAbove: 1.5,
    receiptMultiplier0To1Year: 1.2,
    receiptMultiplier1To3Years: 1.45,
    roi: 9.35,
    processingFees: 0.7,
    loginFees: "Rs 4,000",
    rm: "IndusInd Bank Home Loan Desk",
  },
].map((record, index) => ({
  loanType: "homeLoan",
  commissionType: "percentage",
  commissionValue: 0.35 + index * 0.02,
  commissionMinAmount: 5000,
  commissionMaxAmount: 75000,
  commissionCapAmount: 100000,
  minAge: 21,
  maxAge: record.salaryType === "Salaried" ? 60 : 65,
  maxTenureYears: 30,
  cashRental: "Yes",
  bankRental: "Yes",
  mixRental: "Yes",
  residentialCatALtv: 85 - (index % 3) * 5,
  residentialCatBLtv: 80 - (index % 3) * 5,
  residentialCatCLtv: 75 - (index % 3) * 5,
  commercialCatALtv: 70 - (index % 2) * 5,
  commercialCatBLtv: 65 - (index % 2) * 5,
  commercialCatCLtv: 60 - (index % 2) * 5,
  industrialCatALtv: 65 - (index % 2) * 5,
  industrialCatBLtv: 60 - (index % 2) * 5,
  industrialCatCLtv: 55 - (index % 2) * 5,
  processingFeesType: "percentage",
  insurance: "Property insurance required; life insurance as per bank policy",
  insuranceType: "percentage",
  insuranceValue: 0.25,
  propertyInsuranceRequired: true,
  propertyInsurancePercentage: 0.1,
  lifeInsuranceRequired: index % 2 === 0,
  lifeInsurancePercentage: index % 2 === 0 ? 0.2 : undefined,
  rmMbNo: `90000010${String(index).padStart(2, "0")}`,
  rmMailId: `home.loan.${index + 1}@fintara.test`,
  asm: `${record.bankName} Area Home Loan Manager`,
  asmMailId: `home.asm.${index + 1}@fintara.test`,
  zsm: `${record.bankName} Zonal Home Loan Manager`,
  zsmMailId: `home.zsm.${index + 1}@fintara.test`,
  remarks: `Fintaraa eligibility seed home loan property ${index + 1}`,
  status: EligibilityCriteriaStatus.ACTIVE,
  ...record,
}));

const seed = async () => {
  try {
    await connectDB();

    const payload = [
      ...seedProfiles.slice(0, 100).map((profile, idx) => buildSeed(profile, idx)),
      ...homeLoanPropertySeeds,
    ];

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
