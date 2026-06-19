import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  BankProduct,
  BankProductStatus,
  CardNetwork,
} from "../modals/bankProduct.model";

const cards = [
  {
    name: "HDFC Millennia Credit Card",
    title: "HDFC Millennia Credit Card",
    subtitle: "Cashback card for online shoppers",
    shortDescription:
      "Earn accelerated cashback on popular online brands, dining, and everyday spends.",
    bankName: "HDFC Bank",
    type: "credit_card",
    image: "/assets/banks/hdfc.png",
    link: "https://www.hdfcbank.com/personal/pay/cards/credit-cards/millennia-cc",
    applyUrl: "https://www.hdfcbank.com/personal/pay/cards/credit-cards/millennia-cc",
    annualFee: 1000,
    joiningFee: 1000,
    cardType: "Cashback",
    rewardsType: "Cashback",
    annualFeeBucket: "₹500 - ₹2500",
    incomeRequirementBucket: "₹35,000+",
    welcomeBenefits: "₹1,000 voucher on eligible activation spends.",
    rewardStructure: "5% cashback on select online merchants and 1% on other spends.",
    cashbackDetails: "Monthly cashback capped as per bank policy.",
    loungeAccess: "Limited domestic lounge access on eligible spend milestones.",
    loungeAccessAvailable: true,
    fuelBenefits: "Fuel surcharge waiver at eligible fuel stations.",
    movieBenefits: "Partner movie and lifestyle offers.",
    travelBenefits: "Travel partner offers and dining privileges.",
    insuranceBenefits: "Fraud liability cover as per card terms.",
    eligibilityCriteria: [
      "Indian resident aged 21-60 years.",
      "Stable monthly income and valid PAN required.",
      "Good repayment and bureau history preferred.",
    ],
    eligibilityTermsAndConditions: [
      "Minimum monthly income of ₹35,000.",
      "CIBIL score of 720 or above preferred.",
    ],
    minimumIncome: 35000,
    creditScoreRequirement: 720,
    processingTime: "3-7 working days",
    featuresList: [
      "Online shopping cashback",
      "Dining and lifestyle offers",
      "Fuel surcharge waiver",
    ],
    termsAndConditions: [
      "Fees and benefits are subject to bank policy.",
      "Rewards may vary by merchant category.",
    ],
    faqs: [
      {
        question: "Is this card lifetime free?",
        answer: "No, annual fee applies unless waived by eligible spends.",
      },
      {
        question: "Does this card offer cashback?",
        answer: "Yes, it offers accelerated cashback on select online spends.",
      },
    ],
    cardNetwork: CardNetwork.VISA,
    featured: true,
    priorityOrder: 1,
    rank: 1,
    status: BankProductStatus.ACTIVE,
  },
  {
    name: "SBI Cashback Credit Card",
    title: "SBI Cashback Credit Card",
    subtitle: "High cashback on online spends",
    shortDescription:
      "A simple cashback card for online shoppers with broad category coverage.",
    bankName: "SBI Card",
    type: "credit_card",
    image: "/assets/banks/sbi.png",
    link: "https://www.sbicard.com/en/personal/credit-cards/rewards/cashback-sbi-card.page",
    applyUrl: "https://www.sbicard.com/en/personal/credit-cards/rewards/cashback-sbi-card.page",
    annualFee: 999,
    joiningFee: 999,
    cardType: "Cashback",
    rewardsType: "Cashback",
    annualFeeBucket: "₹500 - ₹2500",
    incomeRequirementBucket: "₹30,000+",
    welcomeBenefits: "Activation benefits as per SBI Card campaigns.",
    rewardStructure: "5% cashback on online spends and 1% on offline spends.",
    cashbackDetails: "Cashback credited to statement subject to monthly cap.",
    loungeAccess: "Not a lounge-led card.",
    loungeAccessAvailable: false,
    fuelBenefits: "1% fuel surcharge waiver on eligible transactions.",
    movieBenefits: "Partner merchant offers.",
    travelBenefits: "Travel and lifestyle offers through SBI Card partners.",
    insuranceBenefits: "Card protection offers as available from the bank.",
    eligibilityCriteria: [
      "Indian resident with regular income.",
      "Valid PAN and address proof required.",
    ],
    eligibilityTermsAndConditions: [
      "Minimum monthly income of ₹30,000.",
      "CIBIL score of 700 or above preferred.",
    ],
    minimumIncome: 30000,
    creditScoreRequirement: 700,
    processingTime: "4-8 working days",
    featuresList: ["Online cashback", "No reward points complexity", "Fuel surcharge waiver"],
    termsAndConditions: ["Cashback exclusions apply.", "Final approval is at bank discretion."],
    faqs: [
      {
        question: "What is the reward type?",
        answer: "This card is cashback-led, not points-led.",
      },
    ],
    cardNetwork: CardNetwork.MASTERCARD,
    featured: true,
    priorityOrder: 2,
    rank: 2,
    status: BankProductStatus.ACTIVE,
  },
  {
    name: "ICICI Amazon Pay Credit Card",
    title: "ICICI Amazon Pay Credit Card",
    subtitle: "Rewards for Amazon and everyday spends",
    shortDescription:
      "A lifetime-free card for Amazon shoppers with strong cashback categories.",
    bankName: "ICICI Bank",
    type: "credit_card",
    image: "/assets/banks/icici.png",
    link: "https://www.icicibank.com/personal-banking/cards/credit-card/amazon-pay-credit-card",
    applyUrl: "https://www.icicibank.com/personal-banking/cards/credit-card/amazon-pay-credit-card",
    annualFee: 0,
    joiningFee: 0,
    cardType: "Shopping",
    rewardsType: "Cashback",
    annualFeeBucket: "Lifetime Free",
    incomeRequirementBucket: "₹25,000+",
    welcomeBenefits: "Amazon Pay welcome rewards subject to campaign eligibility.",
    rewardStructure: "Amazon Pay cashback on Amazon and partner merchants.",
    cashbackDetails: "Cashback credited as Amazon Pay balance.",
    loungeAccess: "No standard lounge access.",
    loungeAccessAvailable: false,
    fuelBenefits: "Fuel surcharge waiver on eligible spends.",
    movieBenefits: "ICICI merchant offers may apply.",
    travelBenefits: "Travel merchant offers through ICICI partnerships.",
    insuranceBenefits: "Purchase protection as per bank terms.",
    eligibilityCriteria: [
      "Amazon account and ICICI eligibility checks required.",
      "Stable income and valid PAN required.",
    ],
    eligibilityTermsAndConditions: [
      "Minimum monthly income of ₹25,000.",
      "CIBIL score of 700 or above preferred.",
    ],
    minimumIncome: 25000,
    creditScoreRequirement: 700,
    processingTime: "Instant to 5 working days",
    featuresList: ["Lifetime free", "Amazon cashback", "Fuel surcharge waiver"],
    termsAndConditions: ["Amazon Pay terms apply.", "Bank approval is required."],
    faqs: [
      {
        question: "Is there an annual fee?",
        answer: "The card is generally positioned as lifetime free.",
      },
    ],
    cardNetwork: CardNetwork.VISA,
    featured: true,
    priorityOrder: 3,
    rank: 3,
    status: BankProductStatus.ACTIVE,
  },
  {
    name: "Axis Bank Flipkart Credit Card",
    title: "Axis Bank Flipkart Credit Card",
    subtitle: "Shopping rewards and partner cashback",
    shortDescription:
      "Designed for Flipkart, Myntra, travel, and everyday shopping benefits.",
    bankName: "Axis Bank",
    type: "credit_card",
    image: "/assets/banks/axis.png",
    link: "https://www.axisbank.com/retail/cards/credit-card/flipkart-axisbank-credit-card",
    applyUrl: "https://www.axisbank.com/retail/cards/credit-card/flipkart-axisbank-credit-card",
    annualFee: 500,
    joiningFee: 500,
    cardType: "Shopping",
    rewardsType: "Cashback",
    annualFeeBucket: "Under ₹500",
    incomeRequirementBucket: "₹25,000+",
    welcomeBenefits: "Welcome vouchers from partner brands.",
    rewardStructure: "Cashback on Flipkart, preferred partners, and all other spends.",
    cashbackDetails: "Unlimited cashback on eligible Flipkart spends as per terms.",
    loungeAccess: "Select airport lounge offers may be available.",
    loungeAccessAvailable: true,
    fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
    movieBenefits: "Entertainment partner discounts.",
    travelBenefits: "Travel partner cashback and offers.",
    insuranceBenefits: "Protection benefits as per card variant.",
    eligibilityCriteria: ["Indian resident aged 18+.", "Income and bureau checks apply."],
    eligibilityTermsAndConditions: [
      "Minimum monthly income of ₹25,000.",
      "CIBIL score of 700 or above preferred.",
    ],
    minimumIncome: 25000,
    creditScoreRequirement: 700,
    processingTime: "3-7 working days",
    featuresList: ["Flipkart cashback", "Partner vouchers", "Fuel surcharge waiver"],
    termsAndConditions: ["Cashback categories may change.", "Final approval rests with Axis Bank."],
    faqs: [
      {
        question: "Does this card support shopping cashback?",
        answer: "Yes, it is focused on shopping and partner cashback.",
      },
    ],
    cardNetwork: CardNetwork.MASTERCARD,
    featured: false,
    priorityOrder: 4,
    rank: 4,
    status: BankProductStatus.ACTIVE,
  },
  {
    name: "IDFC FIRST Wealth Credit Card",
    title: "IDFC FIRST Wealth Credit Card",
    subtitle: "Premium travel and rewards card",
    shortDescription:
      "A premium lifestyle card with lounge, travel, golf, and milestone benefits.",
    bankName: "IDFC FIRST Bank",
    type: "credit_card",
    image: "/assets/banks/idfc.png",
    link: "https://www.idfcfirstbank.com/credit-card/wealth",
    applyUrl: "https://www.idfcfirstbank.com/credit-card/wealth",
    annualFee: 0,
    joiningFee: 0,
    cardType: "Premium",
    rewardsType: "Reward Points",
    annualFeeBucket: "Lifetime Free",
    incomeRequirementBucket: "₹75,000+",
    welcomeBenefits: "Premium partner benefits and welcome vouchers.",
    rewardStructure: "Accelerated reward points on high-value spends.",
    cashbackDetails: "Rewards can be redeemed as per IDFC FIRST catalogue.",
    loungeAccess: "Domestic and international lounge access on eligible usage.",
    loungeAccessAvailable: true,
    fuelBenefits: "Fuel surcharge waiver.",
    movieBenefits: "Movie offers and lifestyle privileges.",
    travelBenefits: "Airport lounge, golf, and travel concierge privileges.",
    insuranceBenefits: "Travel and purchase protection benefits as per terms.",
    eligibilityCriteria: [
      "Premium income profile preferred.",
      "Strong bureau and repayment history required.",
    ],
    eligibilityTermsAndConditions: [
      "Minimum monthly income of ₹75,000.",
      "CIBIL score of 750 or above preferred.",
    ],
    minimumIncome: 75000,
    creditScoreRequirement: 750,
    processingTime: "5-10 working days",
    featuresList: ["Premium lounge access", "Golf privileges", "Reward points"],
    termsAndConditions: ["Premium benefits depend on bank eligibility.", "Spend-linked conditions may apply."],
    faqs: [
      {
        question: "Is this a premium card?",
        answer: "Yes, it is intended for premium income and lifestyle users.",
      },
    ],
    cardNetwork: CardNetwork.VISA,
    featured: true,
    priorityOrder: 5,
    rank: 5,
    status: BankProductStatus.ACTIVE,
  },
];

const seed = async () => {
  try {
    await connectDB();
    for (const card of cards) {
      await BankProduct.findOneAndUpdate(
        { type: card.type, bankName: card.bankName, name: card.name },
        card,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    console.log(`Seeded ${cards.length} credit card bank products.`);
  } catch (error) {
    console.error("Credit card seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
