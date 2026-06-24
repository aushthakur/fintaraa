import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  BankProduct,
  BankProductStatus,
  CardNetwork,
} from "../modals/bankProduct.model";

type CardSeedInput = {
  name: string;
  subtitle: string;
  shortDescription: string;
  cardType: string;
  rewardsType: string;
  annualFee: number;
  joiningFee?: number;
  minimumIncome: number;
  creditScoreRequirement: number;
  loungeAccessAvailable?: boolean;
  cardNetwork: CardNetwork;
  benefits: string[];
  welcomeBenefits: string;
  rewardStructure: string;
  cashbackDetails?: string;
  fuelBenefits?: string;
  movieBenefits?: string;
  travelBenefits?: string;
  insuranceBenefits?: string;
};

type BankSeed = {
  bankName: string;
  image: string;
  cards: CardSeedInput[];
};

const bankApplyUrls: Record<string, string> = {
  "SBI Card": "https://www.sbicard.com/en/personal/credit-cards.page",
  "HDFC Bank": "https://www.hdfcbank.com/personal/pay/cards/credit-cards",
  "ICICI Bank": "https://www.icicibank.com/personal-banking/cards/credit-card",
  "Axis Bank": "https://www.axisbank.com/retail/cards/credit-card",
  "Kotak Mahindra Bank": "https://www.kotak.com/en/personal-banking/cards/credit-cards.html",
  "IndusInd Bank": "https://www.indusind.com/in/en/personal/cards/credit-card.html",
  "IDFC FIRST Bank": "https://www.idfcfirstbank.com/credit-card",
};

const annualFeeBucket = (fee: number) => {
  if (fee <= 0) return "Lifetime Free";
  if (fee <= 500) return "Under ₹500";
  if (fee <= 2500) return "₹500 - ₹2500";
  return "₹2500+";
};

const incomeBucket = (income: number) => {
  if (income <= 25000) return "₹25,000+";
  if (income <= 35000) return "₹35,000+";
  if (income <= 50000) return "₹50,000+";
  if (income <= 75000) return "₹75,000+";
  return "₹1,00,000+";
};

const commonEligibility = (income: number, score: number) => [
  "Indian resident with valid PAN, address proof, and active mobile number.",
  `Minimum monthly income of ${incomeBucket(income)} preferred.`,
  `Credit score of ${score} or above preferred, subject to bank policy.`,
];

const commonTerms = [
  "Fees, rewards, waivers, and benefits are indicative and may change as per bank policy.",
  "Final approval, credit limit, pricing, and card issuance are at the sole discretion of the issuing bank.",
  "Fintaraa helps with discovery and assisted application; the card agreement is executed directly with the bank.",
];

const buildFaqs = (bankName: string, cardName: string, cardType: string) => [
  {
    question: `Who should consider the ${cardName}?`,
    answer: `This ${cardType.toLowerCase()} card can suit customers who want ${bankName} benefits aligned to their everyday spending pattern.`,
  },
  {
    question: "Are fees and benefits final?",
    answer:
      "No. Fees, reward caps, waivers, and partner benefits are subject to the issuing bank's latest terms.",
  },
];

const banks: BankSeed[] = [
  {
    bankName: "SBI Card",
    image: "/assets/banks/sbi-logo.png",
    cards: [
      {
        name: "SBI Cashback Credit Card",
        subtitle: "High cashback on online spends",
        shortDescription:
          "A simple cashback card for online shoppers with broad category coverage.",
        cardType: "Cashback",
        rewardsType: "Cashback",
        annualFee: 999,
        minimumIncome: 30000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Online cashback", "Statement credit", "Fuel surcharge waiver"],
        welcomeBenefits: "Activation benefits as per SBI Card campaigns.",
        rewardStructure: "Cashback on online and offline spends as per card terms.",
        cashbackDetails: "Cashback credited to the statement subject to category and monthly caps.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "SBI SimplyCLICK Credit Card",
        subtitle: "Online shopping rewards card",
        shortDescription:
          "Reward-focused SBI Card for app, ecommerce, and digital spending.",
        cardType: "Shopping",
        rewardsType: "Reward Points",
        annualFee: 499,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Online partner rewards", "Milestone vouchers", "Fuel surcharge waiver"],
        welcomeBenefits: "Welcome voucher on eligible joining spends.",
        rewardStructure: "Accelerated reward points on select online partners.",
        cashbackDetails: "Rewards can be redeemed through SBI Card reward catalogue.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "SBI SimplySAVE Credit Card",
        subtitle: "Everyday spends rewards card",
        shortDescription:
          "Built for grocery, dining, department store, and everyday retail spends.",
        cardType: "Everyday",
        rewardsType: "Reward Points",
        annualFee: 499,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Daily spends rewards", "Dining benefits", "Fuel surcharge waiver"],
        welcomeBenefits: "Bonus reward points on eligible first spends.",
        rewardStructure: "Reward points on dining, grocery, and retail spends.",
        cashbackDetails: "Points redemption available as per SBI Card terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "SBI PRIME Credit Card",
        subtitle: "Premium rewards and travel card",
        shortDescription:
          "Premium SBI Card with milestone rewards, lounge access, and partner privileges.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 2999,
        minimumIncome: 60000,
        creditScoreRequirement: 735,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Airport lounge access", "Milestone vouchers", "Lifestyle privileges"],
        welcomeBenefits: "Premium welcome voucher on eligible fee payment.",
        rewardStructure: "Accelerated points on preferred categories and milestone spends.",
        travelBenefits: "Domestic lounge and travel partner privileges as per terms.",
        insuranceBenefits: "Travel and card protection benefits where applicable.",
      },
      {
        name: "SBI ELITE Credit Card",
        subtitle: "Lifestyle, travel, and entertainment benefits",
        shortDescription:
          "A lifestyle-led premium card for travel, movies, dining, and milestone benefits.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 4999,
        minimumIncome: 75000,
        creditScoreRequirement: 750,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Premium vouchers", "Airport lounge access", "Movie benefits"],
        welcomeBenefits: "Premium joining vouchers subject to eligibility.",
        rewardStructure: "Reward points and milestone benefits on eligible spends.",
        movieBenefits: "Entertainment offers as per active SBI Card partnerships.",
        travelBenefits: "Domestic and international lounge privileges as per terms.",
      },
    ],
  },
  {
    bankName: "HDFC Bank",
    image: "/assets/banks/hdfc.png",
    cards: [
      {
        name: "HDFC Millennia Credit Card",
        subtitle: "Cashback card for online shoppers",
        shortDescription:
          "Earn cashback on popular online brands, dining, and everyday spends.",
        cardType: "Cashback",
        rewardsType: "Cashback",
        annualFee: 1000,
        minimumIncome: 35000,
        creditScoreRequirement: 720,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Online shopping cashback", "Dining offers", "Fuel surcharge waiver"],
        welcomeBenefits: "Welcome voucher on eligible activation spends.",
        rewardStructure: "Cashback on select online merchants and eligible retail spends.",
        cashbackDetails: "Monthly cashback cap applies as per HDFC Bank policy.",
        fuelBenefits: "Fuel surcharge waiver on eligible fuel spends.",
      },
      {
        name: "HDFC Regalia Gold Credit Card",
        subtitle: "Travel, lifestyle, and premium rewards",
        shortDescription:
          "Premium HDFC Bank card with lounge, travel, shopping, and milestone benefits.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 2500,
        minimumIncome: 75000,
        creditScoreRequirement: 750,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Airport lounge access", "Milestone benefits", "Travel rewards"],
        welcomeBenefits: "Premium welcome benefits as per bank campaign.",
        rewardStructure: "Reward points on retail spends with travel redemption options.",
        travelBenefits: "Domestic and international lounge privileges as per card terms.",
        insuranceBenefits: "Travel protection benefits subject to bank policy.",
      },
      {
        name: "HDFC Diners Club Privilege Credit Card",
        subtitle: "Dining, travel, and lifestyle card",
        shortDescription:
          "Diners Club card for customers who prefer dining, travel, and reward-led spends.",
        cardType: "Lifestyle",
        rewardsType: "Reward Points",
        annualFee: 2500,
        minimumIncome: 70000,
        creditScoreRequirement: 740,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.DINERS,
        benefits: ["Dining privileges", "Travel rewards", "Lounge access"],
        welcomeBenefits: "Membership benefits as per bank terms.",
        rewardStructure: "Reward points on eligible retail and partner spends.",
        movieBenefits: "Lifestyle and entertainment offers where available.",
        travelBenefits: "Airport lounge access and travel partner offers.",
      },
      {
        name: "Tata Neu Infinity HDFC Bank Credit Card",
        subtitle: "NeuCoins and partner ecosystem rewards",
        shortDescription:
          "Co-branded card for Tata Neu, shopping, travel, and everyday spends.",
        cardType: "Co-branded",
        rewardsType: "NeuCoins",
        annualFee: 1499,
        minimumIncome: 50000,
        creditScoreRequirement: 720,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["NeuCoins", "Tata brand rewards", "UPI-linked benefits"],
        welcomeBenefits: "Welcome NeuCoins and partner benefits subject to eligibility.",
        rewardStructure: "NeuCoins on eligible Tata Neu and partner spends.",
        cashbackDetails: "NeuCoins and cashback rules follow Tata Neu and bank terms.",
        travelBenefits: "Travel and hotel offers within partner ecosystem.",
      },
      {
        name: "HDFC MoneyBack+ Credit Card",
        subtitle: "Entry-level rewards card",
        shortDescription:
          "Accessible rewards card for first-time and everyday credit card users.",
        cardType: "Rewards",
        rewardsType: "Reward Points",
        annualFee: 500,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Reward points", "Partner offers", "Fuel surcharge waiver"],
        welcomeBenefits: "Welcome benefits as per HDFC Bank policy.",
        rewardStructure: "Reward points on eligible retail and online transactions.",
        cashbackDetails: "Points can be redeemed as per reward catalogue.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
    ],
  },
  {
    bankName: "ICICI Bank",
    image: "/assets/banks/icici.png",
    cards: [
      {
        name: "ICICI Amazon Pay Credit Card",
        subtitle: "Rewards for Amazon and everyday spends",
        shortDescription:
          "A popular shopping card for Amazon Pay rewards and everyday cashback.",
        cardType: "Shopping",
        rewardsType: "Cashback",
        annualFee: 0,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Lifetime free", "Amazon Pay cashback", "Fuel surcharge waiver"],
        welcomeBenefits: "Amazon Pay welcome rewards subject to campaign eligibility.",
        rewardStructure: "Amazon Pay cashback on Amazon and eligible partner merchants.",
        cashbackDetails: "Cashback credited as Amazon Pay balance as per terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible spends.",
      },
      {
        name: "ICICI Bank Coral Credit Card",
        subtitle: "Rewards, movies, and lifestyle benefits",
        shortDescription:
          "Mid-range ICICI Bank card for rewards, movies, dining, and travel offers.",
        cardType: "Lifestyle",
        rewardsType: "Reward Points",
        annualFee: 500,
        minimumIncome: 30000,
        creditScoreRequirement: 700,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Movie offers", "Reward points", "Railway lounge benefits"],
        welcomeBenefits: "Welcome rewards as per active ICICI Bank offer.",
        rewardStructure: "Reward points on retail spends and bonus categories.",
        movieBenefits: "Entertainment offers as per bank partnerships.",
        travelBenefits: "Select lounge and travel partner benefits.",
      },
      {
        name: "ICICI Bank Sapphiro Credit Card",
        subtitle: "Premium travel and lifestyle card",
        shortDescription:
          "Premium card with travel privileges, golf, dining, and reward benefits.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 3500,
        minimumIncome: 80000,
        creditScoreRequirement: 750,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.AMEX,
        benefits: ["Airport lounge access", "Golf benefits", "Premium rewards"],
        welcomeBenefits: "Premium joining benefits subject to card variant.",
        rewardStructure: "Reward points on retail spends and premium categories.",
        travelBenefits: "Airport lounge, travel, and golf privileges as per terms.",
        insuranceBenefits: "Travel protection benefits where applicable.",
      },
      {
        name: "ICICI Bank Platinum Chip Credit Card",
        subtitle: "Simple lifetime-free card",
        shortDescription:
          "Entry-level ICICI Bank card for basic rewards and credit-building needs.",
        cardType: "Entry-level",
        rewardsType: "Reward Points",
        annualFee: 0,
        minimumIncome: 25000,
        creditScoreRequirement: 690,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Lifetime free", "Reward points", "Fuel surcharge waiver"],
        welcomeBenefits: "Basic welcome benefits as per bank policy.",
        rewardStructure: "Reward points on eligible retail transactions.",
        cashbackDetails: "Reward points can be redeemed as per ICICI Bank catalogue.",
        fuelBenefits: "Fuel surcharge waiver on eligible spends.",
      },
      {
        name: "ICICI Bank Rubyx Credit Card",
        subtitle: "Travel, dining, and rewards card",
        shortDescription:
          "Upper-mid range card for customers who want reward points and lifestyle benefits.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 2000,
        minimumIncome: 60000,
        creditScoreRequirement: 730,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Travel rewards", "Dining benefits", "Milestone rewards"],
        welcomeBenefits: "Welcome vouchers and bonus rewards subject to eligibility.",
        rewardStructure: "Reward points and milestone rewards on eligible spends.",
        movieBenefits: "Movie and entertainment benefits as per active offers.",
        travelBenefits: "Select lounge and travel privileges.",
      },
    ],
  },
  {
    bankName: "Axis Bank",
    image: "/assets/banks/axis-bank.png",
    cards: [
      {
        name: "Axis Bank Flipkart Credit Card",
        subtitle: "Shopping rewards and partner cashback",
        shortDescription:
          "Designed for Flipkart, Myntra, travel, and everyday shopping benefits.",
        cardType: "Shopping",
        rewardsType: "Cashback",
        annualFee: 500,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Flipkart cashback", "Partner vouchers", "Fuel surcharge waiver"],
        welcomeBenefits: "Welcome vouchers from partner brands.",
        rewardStructure: "Cashback on Flipkart, preferred partners, and other spends.",
        cashbackDetails: "Cashback categories and caps follow Axis Bank terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "Axis Bank ACE Credit Card",
        subtitle: "Cashback and bill payment card",
        shortDescription:
          "Cashback-led card for bill payments, utilities, and everyday spends.",
        cardType: "Cashback",
        rewardsType: "Cashback",
        annualFee: 499,
        minimumIncome: 30000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Bill payment cashback", "Dining offers", "Fuel surcharge waiver"],
        welcomeBenefits: "Activation benefits as per Axis Bank campaigns.",
        rewardStructure: "Cashback on eligible bill payments and retail spends.",
        cashbackDetails: "Cashback credited as per statement cycle and card terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "Axis Bank My Zone Credit Card",
        subtitle: "Movies, dining, and lifestyle card",
        shortDescription:
          "Lifestyle card with movie, dining, and partner subscription benefits.",
        cardType: "Lifestyle",
        rewardsType: "Partner Offers",
        annualFee: 500,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Movie benefits", "Dining discounts", "Partner offers"],
        welcomeBenefits: "Partner subscription or voucher benefits where eligible.",
        rewardStructure: "Partner-led offers and discounts on eligible categories.",
        movieBenefits: "Movie offers as per active Axis Bank partnerships.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "Axis Bank Atlas Credit Card",
        subtitle: "Travel miles and premium rewards",
        shortDescription:
          "Travel-focused premium card with miles, lounge, and airline partner benefits.",
        cardType: "Travel",
        rewardsType: "Miles",
        annualFee: 5000,
        minimumIncome: 100000,
        creditScoreRequirement: 760,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Travel miles", "Airport lounge access", "Milestone rewards"],
        welcomeBenefits: "Welcome miles subject to fee payment and bank terms.",
        rewardStructure: "Miles on eligible spends with travel redemption options.",
        travelBenefits: "Travel miles, lounge access, and partner airline benefits.",
        insuranceBenefits: "Travel protection benefits as per card terms.",
      },
      {
        name: "Axis Bank Rewards Credit Card",
        subtitle: "Reward points for everyday spends",
        shortDescription:
          "Reward-led Axis Bank card for shopping, dining, and regular transactions.",
        cardType: "Rewards",
        rewardsType: "EDGE Rewards",
        annualFee: 1000,
        minimumIncome: 35000,
        creditScoreRequirement: 710,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["EDGE Rewards", "Partner offers", "Fuel surcharge waiver"],
        welcomeBenefits: "Welcome reward points as per active offer.",
        rewardStructure: "EDGE reward points on eligible domestic and online spends.",
        cashbackDetails: "Rewards redemption follows Axis Bank catalogue rules.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
    ],
  },
  {
    bankName: "Kotak Mahindra Bank",
    image: "/assets/banks/kotak.png",
    cards: [
      {
        name: "Kotak League Platinum Credit Card",
        subtitle: "Lifestyle rewards card",
        shortDescription:
          "Rewards-led Kotak card for shopping, dining, and everyday lifestyle spends.",
        cardType: "Lifestyle",
        rewardsType: "Reward Points",
        annualFee: 499,
        minimumIncome: 30000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.VISA,
        benefits: ["League rewards", "Dining offers", "Fuel surcharge waiver"],
        welcomeBenefits: "Welcome rewards as per Kotak Mahindra Bank policy.",
        rewardStructure: "Reward points on eligible purchases and milestone spends.",
        cashbackDetails: "Rewards redemption follows Kotak catalogue terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "Kotak Mojo Platinum Credit Card",
        subtitle: "Entertainment and rewards card",
        shortDescription:
          "Card for customers who spend on entertainment, shopping, and lifestyle.",
        cardType: "Entertainment",
        rewardsType: "Reward Points",
        annualFee: 1000,
        minimumIncome: 35000,
        creditScoreRequirement: 710,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Movie benefits", "Reward points", "Partner offers"],
        welcomeBenefits: "Joining rewards as per active bank campaign.",
        rewardStructure: "Reward points on eligible shopping and lifestyle spends.",
        movieBenefits: "Entertainment offers where available.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "Kotak Urbane Gold Credit Card",
        subtitle: "Everyday rewards and dining benefits",
        shortDescription:
          "Accessible credit card for regular shoppers and salaried applicants.",
        cardType: "Everyday",
        rewardsType: "Reward Points",
        annualFee: 199,
        minimumIncome: 25000,
        creditScoreRequirement: 690,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Low annual fee", "Reward points", "Dining offers"],
        welcomeBenefits: "Basic welcome benefits as per bank policy.",
        rewardStructure: "Reward points on eligible retail transactions.",
        cashbackDetails: "Reward redemption as per Kotak Mahindra Bank terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible spends.",
      },
      {
        name: "Kotak White Credit Card",
        subtitle: "Premium lifestyle and concierge card",
        shortDescription:
          "Premium Kotak card for lifestyle, concierge, travel, and partner privileges.",
        cardType: "Premium",
        rewardsType: "Milestone Rewards",
        annualFee: 3000,
        minimumIncome: 75000,
        creditScoreRequirement: 745,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Premium rewards", "Concierge benefits", "Travel privileges"],
        welcomeBenefits: "Premium welcome benefits subject to bank eligibility.",
        rewardStructure: "Milestone-led rewards and premium lifestyle offers.",
        travelBenefits: "Travel and lounge privileges as per card terms.",
        insuranceBenefits: "Protection benefits where applicable.",
      },
      {
        name: "Kotak IndianOil Credit Card",
        subtitle: "Fuel-focused savings card",
        shortDescription:
          "Fuel card for customers who want savings on regular IndianOil spends.",
        cardType: "Fuel",
        rewardsType: "Fuel Points",
        annualFee: 449,
        minimumIncome: 25000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.RUPAY,
        benefits: ["Fuel savings", "Reward points", "Low annual fee"],
        welcomeBenefits: "Fuel or reward benefits as per active campaign.",
        rewardStructure: "Fuel-linked rewards on eligible IndianOil spends.",
        cashbackDetails: "Fuel rewards and surcharge waiver follow bank terms.",
        fuelBenefits: "Fuel surcharge waiver and fuel rewards on eligible transactions.",
      },
    ],
  },
  {
    bankName: "IndusInd Bank",
    image: "/assets/banks/indusind.png",
    cards: [
      {
        name: "IndusInd Legend Credit Card",
        subtitle: "Premium lifestyle credit card",
        shortDescription:
          "Premium lifestyle card with travel, rewards, golf, and concierge benefits.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 9999,
        minimumIncome: 100000,
        creditScoreRequirement: 760,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Premium rewards", "Golf benefits", "Airport lounge access"],
        welcomeBenefits: "Premium joining benefits subject to IndusInd Bank policy.",
        rewardStructure: "Reward points on weekday and weekend spends as per card terms.",
        travelBenefits: "Lounge, travel, and concierge privileges as per terms.",
        insuranceBenefits: "Air accident and travel cover where applicable.",
      },
      {
        name: "IndusInd Pinnacle Credit Card",
        subtitle: "High-value rewards card",
        shortDescription:
          "Rewards-led premium card for high-value retail and lifestyle spends.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 15000,
        minimumIncome: 125000,
        creditScoreRequirement: 770,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Premium vouchers", "Reward points", "Travel privileges"],
        welcomeBenefits: "High-value welcome vouchers subject to bank eligibility.",
        rewardStructure: "Reward points and premium redemptions on eligible spends.",
        travelBenefits: "Airport lounge and travel partner offers.",
        insuranceBenefits: "Protection benefits as per card terms.",
      },
      {
        name: "IndusInd Platinum Aura Credit Card",
        subtitle: "Flexible rewards and lifestyle card",
        shortDescription:
          "Lifestyle card with flexible reward plans for shopping, travel, or dining.",
        cardType: "Lifestyle",
        rewardsType: "Reward Points",
        annualFee: 899,
        minimumIncome: 35000,
        creditScoreRequirement: 710,
        cardNetwork: CardNetwork.MASTERCARD,
        benefits: ["Flexible rewards", "Lifestyle offers", "Fuel surcharge waiver"],
        welcomeBenefits: "Reward benefits as per selected plan and bank terms.",
        rewardStructure: "Reward plans can vary by lifestyle category.",
        cashbackDetails: "Reward redemptions follow IndusInd Bank terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "IndusInd EazyDiner Platinum Credit Card",
        subtitle: "Dining-led credit card",
        shortDescription:
          "Dining focused IndusInd card for restaurant offers and food spends.",
        cardType: "Dining",
        rewardsType: "Partner Offers",
        annualFee: 1999,
        minimumIncome: 50000,
        creditScoreRequirement: 725,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Dining discounts", "Restaurant vouchers", "Lifestyle offers"],
        welcomeBenefits: "Dining vouchers as per active card campaign.",
        rewardStructure: "Dining and partner offers on eligible spends.",
        movieBenefits: "Dining and lifestyle partner offers where available.",
        cashbackDetails: "Dining savings and vouchers follow partner terms.",
      },
      {
        name: "IndusInd Nexxt Credit Card",
        subtitle: "Interactive rewards card",
        shortDescription:
          "Lifestyle card with reward-led features and everyday convenience benefits.",
        cardType: "Rewards",
        rewardsType: "Reward Points",
        annualFee: 2500,
        minimumIncome: 60000,
        creditScoreRequirement: 730,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Interactive rewards", "Retail offers", "Travel privileges"],
        welcomeBenefits: "Welcome benefits subject to bank approval and fee payment.",
        rewardStructure: "Reward points on eligible domestic and lifestyle spends.",
        travelBenefits: "Select travel and lifestyle offers as per bank policy.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
    ],
  },
  {
    bankName: "IDFC FIRST Bank",
    image: "/assets/banks/idfc.png",
    cards: [
      {
        name: "IDFC FIRST Wealth Credit Card",
        subtitle: "Premium travel and rewards card",
        shortDescription:
          "Premium lifestyle card with lounge, travel, golf, and milestone benefits.",
        cardType: "Premium",
        rewardsType: "Reward Points",
        annualFee: 0,
        minimumIncome: 75000,
        creditScoreRequirement: 750,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Premium lounge access", "Golf privileges", "Reward points"],
        welcomeBenefits: "Premium partner benefits and welcome vouchers.",
        rewardStructure: "Accelerated reward points on high-value spends.",
        travelBenefits: "Airport lounge, golf, and travel privileges as per terms.",
        insuranceBenefits: "Travel and purchase protection benefits as per terms.",
      },
      {
        name: "IDFC FIRST Select Credit Card",
        subtitle: "Lifestyle rewards and travel benefits",
        shortDescription:
          "Rewards-focused IDFC FIRST card for lifestyle and travel-oriented users.",
        cardType: "Lifestyle",
        rewardsType: "Reward Points",
        annualFee: 0,
        minimumIncome: 50000,
        creditScoreRequirement: 730,
        loungeAccessAvailable: true,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Reward points", "Railway lounge", "Travel offers"],
        welcomeBenefits: "Welcome benefits as per IDFC FIRST Bank terms.",
        rewardStructure: "Reward points on eligible domestic and online spends.",
        travelBenefits: "Travel and lounge privileges as per card eligibility.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "IDFC FIRST Millennia Credit Card",
        subtitle: "Everyday entry-level card",
        shortDescription:
          "Entry-level IDFC FIRST card for regular users and credit-building journeys.",
        cardType: "Everyday",
        rewardsType: "Reward Points",
        annualFee: 0,
        minimumIncome: 25000,
        creditScoreRequirement: 690,
        cardNetwork: CardNetwork.VISA,
        benefits: ["Lifetime free", "Reward points", "Fuel surcharge waiver"],
        welcomeBenefits: "Basic welcome benefits subject to card approval.",
        rewardStructure: "Reward points on eligible retail and online spends.",
        cashbackDetails: "Reward redemptions follow IDFC FIRST Bank terms.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "IDFC FIRST Classic Credit Card",
        subtitle: "Simple rewards card",
        shortDescription:
          "Simple card with rewards, low friction onboarding, and everyday utility.",
        cardType: "Entry-level",
        rewardsType: "Reward Points",
        annualFee: 0,
        minimumIncome: 25000,
        creditScoreRequirement: 690,
        cardNetwork: CardNetwork.VISA,
        benefits: ["No annual fee", "Reward points", "Basic lifestyle offers"],
        welcomeBenefits: "Welcome benefits as per active bank policy.",
        rewardStructure: "Reward points on eligible spends.",
        cashbackDetails: "Reward redemption as per bank catalogue.",
        fuelBenefits: "Fuel surcharge waiver on eligible transactions.",
      },
      {
        name: "IDFC FIRST Power+ Credit Card",
        subtitle: "Fuel and utility savings card",
        shortDescription:
          "Fuel-led card for customers who want savings on fuel and utility payments.",
        cardType: "Fuel",
        rewardsType: "Reward Points",
        annualFee: 499,
        minimumIncome: 30000,
        creditScoreRequirement: 700,
        cardNetwork: CardNetwork.RUPAY,
        benefits: ["Fuel savings", "Utility rewards", "UPI-linked usage"],
        welcomeBenefits: "Fuel or reward benefits as per active campaign.",
        rewardStructure: "Rewards on eligible fuel, utility, and retail spends.",
        cashbackDetails: "Fuel rewards and surcharge waiver follow bank policy.",
        fuelBenefits: "Fuel surcharge waiver and fuel rewards on eligible transactions.",
      },
    ],
  },
];

const cards = banks.flatMap((bank, bankIndex) =>
  bank.cards.map((card, cardIndex) => {
    const priorityOrder = cardIndex + 1;
    const rank = bankIndex * 10 + priorityOrder;
    const joiningFee = card.joiningFee ?? card.annualFee;
    const bankApplyUrl =
      bankApplyUrls[bank.bankName] ||
      "https://www.google.com/search?q=credit+card+apply";
    const termsAndConditions = [
      ...commonTerms,
      ...(card.loungeAccessAvailable
        ? ["Lounge access is subject to network, spend, and bank eligibility rules."]
        : []),
    ];

    return {
      ...card,
      title: card.name,
      bankName: bank.bankName,
      type: "credit_card",
      image: bank.image,
      link: bankApplyUrl,
      applyUrl: bankApplyUrl,
      joiningFee,
      annualFeeBucket: annualFeeBucket(card.annualFee),
      incomeRequirementBucket: incomeBucket(card.minimumIncome),
      loungeAccess: card.loungeAccessAvailable
        ? "Airport lounge access available as per card network and bank policy."
        : "Not a lounge-led card.",
      loungeAccessAvailable: Boolean(card.loungeAccessAvailable),
      fuelBenefits:
        card.fuelBenefits || "Fuel surcharge waiver on eligible transactions.",
      movieBenefits:
        card.movieBenefits || "Movie and entertainment offers may apply as per partner campaigns.",
      travelBenefits:
        card.travelBenefits || "Travel offers may be available through bank and network partners.",
      insuranceBenefits:
        card.insuranceBenefits || "Protection benefits, if any, apply as per card terms.",
      eligibilityCriteria: commonEligibility(
        card.minimumIncome,
        card.creditScoreRequirement,
      ),
      eligibilityTermsAndConditions: [
        `Minimum monthly income of ${incomeBucket(card.minimumIncome)} preferred.`,
        `CIBIL score of ${card.creditScoreRequirement} or above preferred.`,
        "Employment, city, existing relationship, and bureau checks may affect approval.",
      ],
      processingTime: "3-10 working days",
      featuresList: card.benefits,
      termsAndConditions,
      faqs: buildFaqs(bank.bankName, card.name, card.cardType),
      featured: priorityOrder <= 2,
      priorityOrder,
      rank,
      status: BankProductStatus.ACTIVE,
    };
  }),
);

const seed = async () => {
  try {
    await connectDB();
    for (const card of cards) {
      await BankProduct.findOneAndUpdate(
        { type: card.type, bankName: card.bankName, name: card.name },
        card,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    console.log(
      `Seeded ${cards.length} credit card bank products across ${banks.length} banks.`,
    );
  } catch (error) {
    console.error("Credit card seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
