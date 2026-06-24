import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { BankSeoPage, BankSeoPageStatus } from "../modals/bankSeoPage.model";

type LocationSeed = {
  country: string;
  state: string;
  city: string;
  pincode: string;
  area: string;
};

type ProductSeed = {
  name: string;
  slug: string;
  amount: string;
  tenure: string;
  minRate: number;
  maxRate: number;
  processingFee: string;
  purpose: string;
  kind?: "loan" | "credit_card";
};

type BankSeed = {
  name: string;
  slug: string;
  logo: string;
  founded: string;
  branches: string;
  presence: string;
  rateOffset: number;
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const formatRate = (value: number) => `${value.toFixed(2)}%`;

const scopedLocation = (location: LocationSeed) =>
  [location.area, location.pincode, location.city, location.state]
    .filter(Boolean)
    .join(", ");

const canonicalPath = (bankSlug: string, productSlug: string, location: LocationSeed) =>
  [
    "/banks",
    bankSlug,
    productSlug,
    location.state && toSlug(location.state),
    location.city && toSlug(location.city),
    location.pincode && toSlug(location.pincode),
    location.area && toSlug(location.area),
  ]
    .filter(Boolean)
    .join("/");

const locations: LocationSeed[] = [
  { country: "India", state: "", city: "", pincode: "", area: "" },
  { country: "India", state: "Delhi", city: "", pincode: "", area: "" },
  { country: "India", state: "Delhi", city: "New Delhi", pincode: "", area: "" },
  { country: "India", state: "Delhi", city: "New Delhi", pincode: "110001", area: "" },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    pincode: "110001",
    area: "Connaught Place",
  },
  { country: "India", state: "Maharashtra", city: "", pincode: "", area: "" },
  { country: "India", state: "Maharashtra", city: "Mumbai", pincode: "", area: "" },
  {
    country: "India",
    state: "Maharashtra",
    city: "Mumbai",
    pincode: "400053",
    area: "",
  },
  {
    country: "India",
    state: "Maharashtra",
    city: "Mumbai",
    pincode: "400053",
    area: "Andheri West",
  },
  { country: "India", state: "Karnataka", city: "", pincode: "", area: "" },
  { country: "India", state: "Karnataka", city: "Bengaluru", pincode: "", area: "" },
  {
    country: "India",
    state: "Karnataka",
    city: "Bengaluru",
    pincode: "560001",
    area: "",
  },
  {
    country: "India",
    state: "Karnataka",
    city: "Bengaluru",
    pincode: "560001",
    area: "MG Road",
  },
  { country: "India", state: "Uttar Pradesh", city: "", pincode: "", area: "" },
  { country: "India", state: "Uttar Pradesh", city: "Noida", pincode: "", area: "" },
  {
    country: "India",
    state: "Uttar Pradesh",
    city: "Noida",
    pincode: "201301",
    area: "",
  },
  {
    country: "India",
    state: "Uttar Pradesh",
    city: "Noida",
    pincode: "201301",
    area: "Sector 62",
  },
  { country: "India", state: "Haryana", city: "", pincode: "", area: "" },
  { country: "India", state: "Haryana", city: "Gurugram", pincode: "", area: "" },
  {
    country: "India",
    state: "Haryana",
    city: "Gurugram",
    pincode: "122001",
    area: "",
  },
  {
    country: "India",
    state: "Haryana",
    city: "Gurugram",
    pincode: "122001",
    area: "DLF Phase 3",
  },
];

const loanProducts: ProductSeed[] = [
  ["Personal Loan", "personal-loan", "Rs. 50,000 to Rs. 40 lakh", "12 - 84 months", 10.5, 24, "Up to 4%", "urgent personal expenses"],
  ["Education Loan", "education-loan", "Course-cost based", "12 - 180 months", 8.15, 14, "Up to 1.5%", "higher education expenses"],
  ["Vehicle Loan", "vehicle-loan", "Vehicle-value based", "12 - 84 months", 8.75, 13.5, "Up to 2%", "new or used vehicle purchase"],
  ["Gold Loan", "gold-loan", "Gold-value based", "3 - 36 months", 8.75, 16, "Up to 2%", "short-term funds against gold"],
  ["Loan Against Car", "loan-against-car", "Car-value based", "12 - 60 months", 11.5, 20, "Up to 3%", "funds against an owned car"],
  ["Car Loan", "car-loan", "On-road price based", "12 - 84 months", 8.9, 13, "Up to 2%", "car purchase financing"],
  ["Loan Against Car Value", "loan-against-car-value", "Car-valuation based", "12 - 60 months", 11.25, 19.5, "Up to 3%", "secured liquidity against car value"],
  ["Instant Loan", "instant-loan", "Profile based", "3 - 60 months", 11.99, 30, "Up to 5%", "quick digital funding"],
  ["Credit Score Loan", "credit-score-loan", "Credit-profile based", "6 - 72 months", 10.99, 26, "Up to 4%", "bureau-led loan offers"],
  ["Loan Against Property", "loan-against-property", "Property-value based", "36 - 240 months", 9.25, 15, "Up to 2%", "larger secured funding"],
  ["Renovation Loan", "renovation-loan", "Project-estimate based", "12 - 84 months", 10.75, 22, "Up to 3%", "home repairs and interiors"],
  ["Working Capital Loan", "working-capital-loan", "Turnover based", "6 - 60 months", 12, 24, "Up to 3.5%", "business cash-flow needs"],
  ["Loan Against Security", "loan-against-security", "Security-value based", "6 - 60 months", 9.5, 16, "Up to 2%", "funds against eligible securities"],
  ["Machinery Loan", "machinery-loan", "Invoice based", "12 - 84 months", 10.5, 18, "Up to 2.5%", "machinery purchase or refinance"],
  ["Home Loan", "home-loan", "Property and income based", "60 - 360 months", 7.1, 10.5, "0.35% - 1%", "home purchase or construction"],
  ["Business Loan", "business-loan", "Rs. 1 lakh to Rs. 1 crore", "12 - 84 months", 11.25, 24, "Up to 4%", "business expansion or working capital"],
  ["DOD Loan", "dod-loan", "Limit assessment based", "12 - 60 months", 11, 19, "Up to 2.5%", "demand overdraft liquidity"],
  ["OD Loan", "od-loan", "Limit assessment based", "12 - 60 months", 10.75, 18.5, "Up to 2.5%", "overdraft facility support"],
  ["Industrial Loan", "industrial-loan", "Project based", "12 - 120 months", 10.5, 18, "Up to 2.5%", "industrial expansion"],
  ["Commercial Purchases Loan", "commercial-purchases-loan", "Asset based", "12 - 120 months", 10.75, 18.5, "Up to 2.5%", "commercial asset purchase"],
  ["Balance Transfer Loan", "balance-transfer-loan", "Outstanding-loan based", "12 - 240 months", 8.5, 14, "Up to 1.5%", "existing loan transfer"],
  ["Top Up Loan", "top-up-loan", "Existing-loan based", "12 - 180 months", 9.5, 16, "Up to 2%", "additional funding over existing loan"],
  ["Two Wheeler Loan", "two-wheeler-loan", "Vehicle-value based", "6 - 60 months", 9.5, 18, "Up to 2.5%", "scooter or motorcycle purchase"],
  ["Used Car Loan", "used-car-loan", "Used-car valuation based", "12 - 72 months", 10.25, 16, "Up to 2.5%", "pre-owned car purchase"],
  ["Agriculture Loan", "agriculture-loan", "Farm profile based", "6 - 84 months", 8.5, 15, "As per scheme", "farm and allied agriculture needs"],
].map(([name, slug, amount, tenure, minRate, maxRate, processingFee, purpose]) => ({
  name: String(name),
  slug: String(slug),
  amount: String(amount),
  tenure: String(tenure),
  minRate: Number(minRate),
  maxRate: Number(maxRate),
  processingFee: String(processingFee),
  purpose: String(purpose),
  kind: "loan" as const,
}));

const creditCardProducts: ProductSeed[] = [
  ["Credit Card", "credit-card", "Bank-card limit based", "Monthly billing cycle", 0, 0, "Joining/annual fee varies", "bank credit card applications"],
  ["Cashback Credit Card", "cashback-credit-card", "Bank-card limit based", "Monthly billing cycle", 0, 0, "Joining/annual fee varies", "cashback-led card spends"],
  ["Rewards Credit Card", "rewards-credit-card", "Bank-card limit based", "Monthly billing cycle", 0, 0, "Joining/annual fee varies", "reward point benefits"],
  ["Travel Credit Card", "travel-credit-card", "Bank-card limit based", "Monthly billing cycle", 0, 0, "Joining/annual fee varies", "travel and lounge benefits"],
  ["Lifetime Free Credit Card", "lifetime-free-credit-card", "Bank-card limit based", "Monthly billing cycle", 0, 0, "Nil/waived where eligible", "low-fee card discovery"],
].map(([name, slug, amount, tenure, minRate, maxRate, processingFee, purpose]) => ({
  name: String(name),
  slug: String(slug),
  amount: String(amount),
  tenure: String(tenure),
  minRate: Number(minRate),
  maxRate: Number(maxRate),
  processingFee: String(processingFee),
  purpose: String(purpose),
  kind: "credit_card" as const,
}));

const products = [...loanProducts, ...creditCardProducts];

const banks: BankSeed[] = [
  { name: "SBI Card", slug: "sbi-card", logo: "/assets/banks/sbi-logo.png", founded: "1998", branches: "PAN India", presence: "300+ Cities", rateOffset: -0.15 },
  { name: "HDFC Bank", slug: "hdfc-bank", logo: "/assets/banks/hdfc.png", founded: "1994", branches: "8,000+", presence: "3,800+ Cities", rateOffset: 0 },
  { name: "ICICI Bank", slug: "icici-bank", logo: "/assets/banks/icici.png", founded: "1994", branches: "6,000+", presence: "2,000+ Cities", rateOffset: 0.15 },
  { name: "Axis Bank", slug: "axis-bank", logo: "/assets/banks/axis-bank.png", founded: "1993", branches: "5,000+", presence: "1,900+ Cities", rateOffset: 0.35 },
  { name: "Kotak Mahindra Bank", slug: "kotak-mahindra-bank", logo: "/assets/banks/kotak.png", founded: "2003", branches: "1,900+", presence: "900+ Cities", rateOffset: 0.25 },
  { name: "IndusInd Bank", slug: "indusind-bank", logo: "/assets/banks/indusind.png", founded: "1994", branches: "2,700+", presence: "1,400+ Cities", rateOffset: 0.45 },
  { name: "IDFC FIRST Bank", slug: "idfc-first-bank", logo: "/assets/banks/idfc.png", founded: "2015", branches: "900+", presence: "600+ Cities", rateOffset: 0.2 },
];

const productLinks = (bank: BankSeed) =>
  products.map((product, index) => ({
    title: product.name,
    description:
      product.kind === "credit_card"
        ? `${product.name} options, fees and benefits from ${bank.name}.`
        : `${product.amount}; interest from ${formatRate(product.minRate + bank.rateOffset)} p.a.`,
    href: `/banks/${bank.slug}/${product.slug}`,
    ctaLabel: product.kind === "credit_card" ? "View Cards" : "Apply Now",
    sortOrder: index + 1,
    isActive: true,
  }));

const tabsFor = (bank: BankSeed, product: ProductSeed, location: LocationSeed) => {
  const locationText = scopedLocation(location);
  const scoped = locationText
    ? `${bank.name} ${product.name} in ${locationText}`
    : `${bank.name} ${product.name}`;
  const isCard = product.kind === "credit_card";
  return [
    {
      key: "all_details",
      label: "All Details",
      title: `${scoped} - complete details`,
      description: `Review overview, ${isCard ? "fees, benefits, eligibility, documents, and available cards" : "interest rates, EMI, eligibility, documents, fees, and application support"} in one place.`,
      content: [
        `${scoped} can be compared on Fintaraa with assisted discovery and profile-based next steps.`,
        isCard
          ? "Available cards, joining fee, annual fee, rewards, cashback, lounge, and network details are shown where bank data is available."
          : "Indicative rates, amount range, processing fee, tenure, and document expectations are shown before application.",
      ],
      bullets: [
        "Profile-led guidance",
        "Secure assisted application",
        "Clear document and fee expectations",
        "Location-wise service support",
      ],
      sortOrder: 1,
      isActive: true,
    },
    {
      key: "overview",
      label: "Overview",
      title: `${scoped} overview`,
      content: [
        `${product.name} from ${bank.name} can support ${product.purpose}. Fintaraa helps users compare available options and move through documentation with guided support.`,
      ],
      bullets: ["Partner-backed journey", "Transparent next steps", "City and area support"],
      sortOrder: 2,
      isActive: true,
    },
    {
      key: "interest_rate",
      label: isCard ? "Fees" : "Interest Rate",
      title: isCard ? `${scoped} fees` : `${scoped} interest rate`,
      content: [
        isCard
          ? "Credit card joining fee, annual fee, waiver, and rewards depend on the selected card variant and bank approval."
          : `Indicative interest range starts from ${formatRate(product.minRate + bank.rateOffset)} p.a. and can vary by profile, income, bureau history, collateral, and bank policy.`,
      ],
      bullets: isCard
        ? ["Joining fee varies by card", "Annual fee waiver may apply", "Rewards and caps follow bank terms"]
        : ["Rate varies by profile", "Processing fee may apply", "Final sanction comes from bank"],
      sortOrder: 3,
      isActive: true,
    },
    {
      key: "eligibility",
      label: "Eligibility",
      title: `${scoped} eligibility`,
      content: [
        "Eligibility depends on income, employment or business profile, bureau behaviour, city, documents, and existing obligations.",
      ],
      bullets: ["Valid PAN and KYC", "Stable income source", "Responsible repayment track"],
      sortOrder: 4,
      isActive: true,
    },
    {
      key: "documents",
      label: "Documents",
      title: `${scoped} documents`,
      content: [
        "Commonly requested documents include PAN, Aadhaar or address proof, income proof, bank statements, photograph, and product-specific documents.",
      ],
      bullets: ["Identity proof", "Address proof", "Income and bank statement proof"],
      sortOrder: 5,
      isActive: true,
    },
    {
      key: isCard ? "credit_cards" : "emi_calculator",
      label: isCard ? "Credit Cards" : "EMI Calculator",
      title: isCard ? `${bank.name} credit cards` : `${scoped} EMI planning`,
      content: [
        isCard
          ? `Compare active ${bank.name} credit cards by fees, rewards, network, income requirement, and benefits.`
          : "Use EMI planning to compare tenure, monthly repayment comfort, and total interest before applying.",
      ],
      bullets: isCard
        ? ["Bank-wise cards", "Fees and rewards", "Eligibility support"]
        : ["Monthly EMI comfort", "Tenure comparison", "Total repayment view"],
      sortOrder: 6,
      isActive: true,
    },
    {
      key: "products",
      label: "Products",
      title: `${bank.name} products on Fintaraa`,
      content: ["Browse loan and credit-card pages available for this bank."],
      bullets: ["Loans", "Credit cards", "Location-wise bank pages"],
      sortOrder: 7,
      isActive: true,
    },
    {
      key: "why_bank",
      label: `Why ${bank.name.split(" ")[0]}`,
      title: `Why apply with ${bank.name} through Fintaraa`,
      content: [
        "Fintaraa helps customers understand options, documentation, and application status while the bank manages final approval and terms.",
      ],
      bullets: ["Assisted journey", "Partner-backed offers", "Secure document handling"],
      sortOrder: 8,
      isActive: true,
    },
    {
      key: "reviews",
      label: "Reviews",
      title: `${scoped} customer reviews`,
      content: ["Customer feedback is based on assisted application journeys and partner follow-ups."],
      sortOrder: 9,
      isActive: true,
    },
    {
      key: "faqs",
      label: "FAQs",
      title: `${scoped} FAQs`,
      content: [
        "Common questions include eligibility, document needs, approval time, fees, credit score impact, and bank-side final decision.",
      ],
      bullets: [
        "Final approval is bank-led",
        "Rates and fees are indicative",
        "Documents vary by profile",
      ],
      sortOrder: 10,
      isActive: true,
    },
  ];
};

const ratesFor = (product: ProductSeed, bank: BankSeed) => {
  if (product.kind === "credit_card") {
    return [
      { loanAmount: "Entry-level cards", interestRate: "As per statement terms", processingFee: "Nil to low annual fee", tenure: "Monthly billing cycle", sortOrder: 1 },
      { loanAmount: "Cashback cards", interestRate: "As per card terms", processingFee: "Joining/annual fee varies", tenure: "Monthly billing cycle", sortOrder: 2 },
      { loanAmount: "Rewards cards", interestRate: "As per card terms", processingFee: "Fee waiver may apply", tenure: "Monthly billing cycle", sortOrder: 3 },
      { loanAmount: "Premium cards", interestRate: "As per card terms", processingFee: "Premium fee varies", tenure: "Monthly billing cycle", sortOrder: 4 },
    ];
  }
  const min = product.minRate + bank.rateOffset;
  const max = product.maxRate + bank.rateOffset;
  return [
    { loanAmount: product.amount, interestRate: `${formatRate(min)} - ${formatRate(max)}`, processingFee: product.processingFee, tenure: product.tenure, sortOrder: 1 },
    { loanAmount: "Profile-based offer", interestRate: `${formatRate(min + 0.25)} onwards`, processingFee: product.processingFee, tenure: product.tenure, sortOrder: 2 },
    { loanAmount: "Existing customer offer", interestRate: `${formatRate(Math.max(0, min - 0.1))} onwards`, processingFee: "As per bank policy", tenure: product.tenure, sortOrder: 3 },
    { loanAmount: "High eligibility profile", interestRate: `${formatRate(Math.max(0, min - 0.2))} onwards`, processingFee: "Negotiable where eligible", tenure: product.tenure, sortOrder: 4 },
  ];
};

const pageFor = (bank: BankSeed, product: ProductSeed, location: LocationSeed, priority: number) => {
  const locationText = scopedLocation(location);
  const scoped = locationText
    ? `${bank.name} ${product.name} in ${locationText}`
    : `${bank.name} ${product.name}`;
  const isCard = product.kind === "credit_card";

  return {
    bankName: bank.name,
    bankSlug: bank.slug,
    productName: product.name,
    productSlug: product.slug,
    title: scoped,
    subtitle: isCard
      ? `Compare ${bank.name} ${product.name} options, fees, rewards, eligibility, and assisted application support.`
      : `Apply for ${product.name} from ${bank.name} with interest from ${formatRate(product.minRate + bank.rateOffset)} p.a. and assisted application support.`,
    logoUrl: bank.logo,
    heroImageUrl: "",
    trustBadge: "Trusted Partner",
    seoTitle: `${scoped} | Fintaraa`,
    seoDescription: isCard
      ? `Compare ${scoped} with Fintaraa. Review fees, rewards, eligibility, documents, and active bank cards.`
      : `Apply for ${scoped} with Fintaraa. Review interest rates, eligibility, documents, EMI, fees, and location-wise bank support.`,
    canonicalPath: canonicalPath(bank.slug, product.slug, location),
    aboutTitle: `About ${bank.name}`,
    aboutDescription: `${bank.name} is a trusted financial partner on Fintaraa for loans and credit-card journeys. Customers can compare products, understand documents and fees, and continue with guided application support.`,
    location,
    heroStats: isCard
      ? [
          { label: "Card Options", value: "5 active cards" },
          { label: "Rewards", value: "Cashback & points" },
          { label: "Fees", value: "Variant based" },
          { label: "Process", value: "Assisted online" },
        ]
      : [
          { label: "Interest Rate", value: `From ${formatRate(product.minRate + bank.rateOffset)} p.a.` },
          { label: "Amount", value: product.amount },
          { label: "Tenure", value: product.tenure },
          { label: "Process", value: "Assisted online" },
        ],
    bankStats: [
      { label: "Founded", value: bank.founded },
      { label: "Branches", value: bank.branches },
      { label: "Presence", value: bank.presence },
    ],
    whyApply: [
      "Free and guided application support",
      "Secure document handling",
      "Bank-wise product comparison",
      "Location-wise assistance",
    ],
    products: productLinks(bank),
    tabs: tabsFor(bank, product, location),
    interestRates: ratesFor(product, bank),
    applyBullets: [
      "Minimal initial details",
      "Document guidance",
      "Partner-backed application tracking",
    ],
    status: BankSeoPageStatus.ACTIVE,
    publishedAt: new Date(),
    isFeatured: !location.state && ["personal-loan", "home-loan", "business-loan", "credit-card"].includes(product.slug),
    isIndexable: true,
    priority,
  };
};

const seed = async () => {
  try {
    await connectDB();
    const operations = banks.flatMap((bank, bankIndex) =>
      products.flatMap((product, productIndex) =>
        locations.map((location, locationIndex) => {
          const page = pageFor(
            bank,
            product,
            location,
            bankIndex * 10000 + productIndex * 100 + locationIndex + 1,
          );
          return {
            updateOne: {
              filter: {
                bankSlug: bank.slug,
                productSlug: product.slug,
                "location.country": location.country,
                "location.state": location.state,
                "location.city": location.city,
                "location.pincode": location.pincode,
                "location.area": location.area,
              },
              update: { $set: page },
              upsert: true,
            },
          };
        }),
      ),
    );

    const result = await BankSeoPage.bulkWrite(operations, { ordered: false });
    console.log(
      `Seeded bank SEO pages: ${operations.length} planned, ${result.upsertedCount} inserted, ${result.modifiedCount} updated.`,
    );
  } catch (error) {
    console.error("Bank SEO seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
