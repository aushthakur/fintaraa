import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { LoanSeoPage, LoanSeoPageStatus } from "../modals/loanSeoPage.model";
import {
  InsuranceSeoPage,
  InsuranceSeoPageStatus,
} from "../modals/insuranceSeoPage.model";
import { Area, City, Country, Pincode, State } from "../modals/statecity.model";

type SeedLocation = {
  country: string;
  state: string;
  city: string;
  pincode: string;
  area: string;
};

type LoanProductSeed = {
  name: string;
  slug: string;
  purpose: string;
  secured?: boolean;
  amountHint: string;
};

type InsuranceProductSeed = {
  name: string;
  slug: string;
  coverageFocus: string;
};

const now = new Date();

const baseLocation: SeedLocation = {
  country: "India",
  state: "",
  city: "",
  pincode: "",
  area: "",
};

const locations = [
  {
    country: { name: "India", code: "IN" },
    state: { name: "Maharashtra", code: "MH" },
    cities: [
      {
        name: "Mumbai",
        pincodes: [
          { code: "400001", areas: ["Fort", "Nariman Point"] },
          { code: "400053", areas: ["Andheri West", "Lokhandwala"] },
          { code: "400051", areas: ["Bandra Kurla Complex", "Bandra East"] },
        ],
      },
      {
        name: "Pune",
        pincodes: [{ code: "411001", areas: ["Camp", "Bund Garden"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Delhi", code: "DL" },
    cities: [
      {
        name: "New Delhi",
        pincodes: [
          { code: "110001", areas: ["Connaught Place", "Janpath"] },
          { code: "110005", areas: ["Karol Bagh", "Rajendra Place"] },
          { code: "110016", areas: ["Hauz Khas", "Green Park"] },
          { code: "110017", areas: ["Malviya Nagar", "Saket"] },
          { code: "110019", areas: ["Nehru Place", "Kalkaji"] },
          { code: "110024", areas: ["Lajpat Nagar", "Defence Colony"] },
          { code: "110085", areas: ["Rohini Sector 7", "Pitampura"] },
          { code: "110092", areas: ["Laxmi Nagar", "Preet Vihar"] },
        ],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Karnataka", code: "KA" },
    cities: [
      {
        name: "Bengaluru",
        pincodes: [
          { code: "560001", areas: ["MG Road", "Ashok Nagar"] },
          { code: "560066", areas: ["Whitefield", "ITPL"] },
        ],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Haryana", code: "HR" },
    cities: [
      {
        name: "Gurugram",
        pincodes: [{ code: "122002", areas: ["Cyber City", "Golf Course Road"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Uttar Pradesh", code: "UP" },
    cities: [
      {
        name: "Noida",
        pincodes: [{ code: "201301", areas: ["Sector 18", "Sector 62"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Tamil Nadu", code: "TN" },
    cities: [
      {
        name: "Chennai",
        pincodes: [{ code: "600017", areas: ["T Nagar", "Adyar"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Telangana", code: "TG" },
    cities: [
      {
        name: "Hyderabad",
        pincodes: [{ code: "500081", areas: ["HITEC City", "Banjara Hills"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Gujarat", code: "GJ" },
    cities: [
      {
        name: "Ahmedabad",
        pincodes: [{ code: "380009", areas: ["CG Road", "Navrangpura"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Rajasthan", code: "RJ" },
    cities: [
      {
        name: "Jaipur",
        pincodes: [{ code: "302001", areas: ["C Scheme", "Malviya Nagar"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "West Bengal", code: "WB" },
    cities: [
      {
        name: "Kolkata",
        pincodes: [{ code: "700016", areas: ["Park Street", "Salt Lake"] }],
      },
    ],
  },
];

const loanProducts: LoanProductSeed[] = [
  {
    name: "Personal Loan",
    slug: "personal-loan",
    purpose: "medical needs, travel, weddings, debt consolidation, or urgent personal expenses",
    amountHint: "Rs. 50,000 to Rs. 40 lakh",
  },
  {
    name: "Education Loan",
    slug: "education-loan",
    purpose: "tuition fees, living costs, exam fees, and education-linked expenses",
    secured: true,
    amountHint: "course and institution based",
  },
  {
    name: "Vehicle Loan",
    slug: "vehicle-loan",
    purpose: "new or used vehicle purchase with structured repayment",
    secured: true,
    amountHint: "vehicle value based",
  },
  {
    name: "Gold Loan",
    slug: "gold-loan",
    purpose: "short-term funds against eligible pledged gold",
    secured: true,
    amountHint: "gold value based",
  },
  {
    name: "Loan Against Car",
    slug: "loan-against-car",
    purpose: "funds against an eligible owned car without selling it",
    secured: true,
    amountHint: "car valuation based",
  },
  {
    name: "Car Loan",
    slug: "car-loan",
    purpose: "new car purchase, used car purchase, or dealer-backed financing",
    secured: true,
    amountHint: "on-road price based",
  },
  {
    name: "Loan Against Car Value",
    slug: "loan-against-car-value",
    purpose: "secured liquidity based on current car valuation",
    secured: true,
    amountHint: "eligible car value based",
  },
  {
    name: "Instant Loan",
    slug: "instant-loan",
    purpose: "quick digital funding needs with minimal initial steps",
    amountHint: "profile and partner based",
  },
  {
    name: "Credit Score Loan",
    slug: "credit-score-loan",
    purpose: "credit profile based offers where score and bureau history matter",
    amountHint: "credit profile based",
  },
  {
    name: "Loan Against Property",
    slug: "loan-against-property",
    purpose: "larger secured funding against residential or commercial property",
    secured: true,
    amountHint: "property valuation based",
  },
  {
    name: "Renovation Loan",
    slug: "renovation-loan",
    purpose: "home repair, interiors, upgrades, and construction-linked improvement",
    amountHint: "project estimate based",
  },
  {
    name: "Working Capital Loan",
    slug: "working-capital-loan",
    purpose: "inventory, vendor payments, cash flow gaps, and operating cycles",
    amountHint: "turnover and banking based",
  },
  {
    name: "Loan Against Security",
    slug: "loan-against-security",
    purpose: "credit against eligible securities or financial assets",
    secured: true,
    amountHint: "security value based",
  },
  {
    name: "Machinery Loan",
    slug: "machinery-loan",
    purpose: "purchase, upgrade, or refinance of eligible business machinery",
    secured: true,
    amountHint: "machine invoice based",
  },
  {
    name: "Home Loan",
    slug: "home-loan",
    purpose: "home purchase, construction, balance transfer, or top-up needs",
    secured: true,
    amountHint: "property and income based",
  },
  {
    name: "Business Loan",
    slug: "business-loan",
    purpose: "business expansion, working capital, hiring, stock, and equipment",
    amountHint: "turnover and bank statement based",
  },
  {
    name: "DOD Loan",
    slug: "dod-loan",
    purpose: "demand overdraft style funding for eligible business cash flow",
    secured: true,
    amountHint: "banking and collateral based",
  },
  {
    name: "OD Loan",
    slug: "od-loan",
    purpose: "overdraft facility support for short-term business liquidity",
    secured: true,
    amountHint: "limit assessment based",
  },
  {
    name: "Industrial Loan",
    slug: "industrial-loan",
    purpose: "manufacturing, industrial expansion, plant upgrades, and unit operations",
    secured: true,
    amountHint: "project and collateral based",
  },
  {
    name: "Commercial Purchases Loan",
    slug: "commercial-purchases-loan",
    purpose: "commercial assets, equipment, inventory, or property-linked purchases",
    secured: true,
    amountHint: "invoice and asset based",
  },
  {
    name: "Balance Transfer Loan",
    slug: "balance-transfer-loan",
    purpose: "moving an existing loan to better repayment terms where eligible",
    secured: true,
    amountHint: "outstanding loan based",
  },
  {
    name: "Top Up Loan",
    slug: "top-up-loan",
    purpose: "additional funding over an eligible existing loan relationship",
    secured: true,
    amountHint: "repayment track and outstanding based",
  },
  {
    name: "Two Wheeler Loan",
    slug: "two-wheeler-loan",
    purpose: "new or used scooter and motorcycle purchases",
    secured: true,
    amountHint: "vehicle value based",
  },
  {
    name: "Used Car Loan",
    slug: "used-car-loan",
    purpose: "pre-owned car purchase with valuation and ownership checks",
    secured: true,
    amountHint: "used car valuation based",
  },
  {
    name: "Agriculture Loan",
    slug: "agriculture-loan",
    purpose: "farm inputs, equipment, irrigation, crop cycle, or allied agriculture needs",
    secured: true,
    amountHint: "land, crop, and cash flow based",
  },
];

const insuranceProducts: InsuranceProductSeed[] = [
  {
    name: "Life Insurance",
    slug: "life-insurance",
    coverageFocus: "family financial protection and long-term security",
  },
  {
    name: "Health Insurance",
    slug: "health-insurance",
    coverageFocus: "hospitalisation, medical expenses, and planned health cover",
  },
  {
    name: "Car Insurance",
    slug: "car-insurance",
    coverageFocus: "own damage, third-party liability, and vehicle protection",
  },
  {
    name: "Bike Insurance",
    slug: "bike-insurance",
    coverageFocus: "two-wheeler protection, liability cover, and renewal support",
  },
  {
    name: "Home Insurance",
    slug: "home-insurance",
    coverageFocus: "home structure, contents, and covered loss protection",
  },
  {
    name: "Group Insurance",
    slug: "group-insurance",
    coverageFocus: "employee, member, or group-level protection",
  },
  {
    name: "Personal Accident Insurance",
    slug: "personal-accident-insurance",
    coverageFocus: "accidental death, disability, and income disruption protection",
  },
  {
    name: "Critical Illness Insurance",
    slug: "critical-illness-insurance",
    coverageFocus: "listed critical illness events and lump-sum support",
  },
  {
    name: "Vehicle Insurance",
    slug: "vehicle-insurance",
    coverageFocus: "car, bike, and commercial vehicle risk protection",
  },
  {
    name: "Property Insurance",
    slug: "property-insurance",
    coverageFocus: "property, business premises, and asset risk protection",
  },
  {
    name: "Stock Insurance",
    slug: "stock-insurance",
    coverageFocus: "inventory and stock protection against covered risks",
  },
  {
    name: "Machinery Insurance",
    slug: "machinery-insurance",
    coverageFocus: "machine breakdown, damage, and business asset protection",
  },
  {
    name: "Term Insurance",
    slug: "term-insurance",
    coverageFocus: "pure life cover with high protection at structured premium",
  },
  {
    name: "Travel Insurance",
    slug: "travel-insurance",
    coverageFocus: "trip, medical, baggage, and travel disruption support",
  },
  {
    name: "Retirement Plan",
    slug: "retirement-plan",
    coverageFocus: "retirement income, savings discipline, and future planning",
  },
  {
    name: "Shop Insurance",
    slug: "shop-insurance",
    coverageFocus: "shop premises, stock, contents, and business interruption risks",
  },
];

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const locationLabel = (location: SeedLocation) =>
  [location.area, location.pincode, location.city, location.state]
    .filter(Boolean)
    .join(", ");

const scopedProductName = (name: string, location: SeedLocation) => {
  const label = locationLabel(location);
  return label ? `${name} in ${label}` : name;
};

const cityPhrase = (location: SeedLocation) =>
  location.city ? ` in ${location.city}` : "";

const canonicalPath = (productSlug: string, location: SeedLocation) =>
  [
    "/products",
    productSlug,
    slugify(location.state),
    slugify(location.city),
    slugify(location.pincode),
    slugify(location.area),
  ]
    .filter(Boolean)
    .join("/");

const locationQuery = (
  slugField: "loanTypeSlug" | "insuranceTypeSlug",
  slug: string,
  location: SeedLocation,
) => ({
  [slugField]: slug,
  "location.country": location.country,
  "location.state": location.state,
  "location.city": location.city,
  "location.pincode": location.pincode,
  "location.area": location.area,
});

const locationVariants = (location: SeedLocation) => {
  if (!location.state) return [baseLocation];

  const variants: SeedLocation[] = [
    {
      country: location.country,
      state: location.state,
      city: "",
      pincode: "",
      area: "",
    },
  ];

  if (location.city) {
    variants.push({
      country: location.country,
      state: location.state,
      city: location.city,
      pincode: "",
      area: "",
    });
  }

  if (location.city && location.pincode) {
    variants.push({
      country: location.country,
      state: location.state,
      city: location.city,
      pincode: location.pincode,
      area: "",
    });
  }

  if (location.city && location.pincode && location.area) {
    variants.push(location);
  }

  return variants;
};

const expandPlanLocations = <T>(
  plans: Array<{ product: T; location: SeedLocation }>,
  slugOf: (product: T) => string,
) => {
  const seen = new Set<string>();
  const expanded: Array<{ product: T; location: SeedLocation }> = [];

  for (const plan of plans) {
    for (const location of locationVariants(plan.location)) {
      const key = `${slugOf(plan.product)}:${location.country}:${location.state}:${location.city}:${location.pincode}:${location.area}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({ product: plan.product, location });
    }
  }

  return expanded;
};

const findLocation = (
  seededAreas: SeedLocation[],
  city: string,
  area: string,
) =>
  seededAreas.find(
    (location) => location.city === city && location.area === area,
  ) || seededAreas[0];

const buildLoanFaqs = (product: LoanProductSeed) => [
  {
    question: `What is the minimum income needed for ${product.name}?`,
    answer:
      "Minimum income depends on partner policy, loan amount, employment type, current obligations, and location. Fintaraa captures the details required to shortlist suitable options.",
  },
  {
    question: `How fast can ${product.name} be processed?`,
    answer:
      "Processing depends on document readiness, credit checks, asset checks where applicable, and lender verification. Complete details usually reduce back-and-forth.",
  },
  {
    question: `Can I apply for ${product.name} in Delhi or Mumbai?`,
    answer:
      "Yes, Fintaraa supports location-specific discovery for cities including Delhi, Mumbai, Bengaluru, Pune, Gurugram, Noida, Chennai, Hyderabad, Ahmedabad, Jaipur, and Kolkata.",
  },
];

const buildLoanTabs = (product: LoanProductSeed, scoped: string) => {
  const secureNote = product.secured
    ? "Asset, collateral, invoice, valuation, or property checks may be required based on partner policy."
    : "No collateral is usually required unless a partner asks for additional comfort based on profile.";
  const faqs = buildLoanFaqs(product);

  return [
    {
      key: "all_details",
      label: "All Details",
      eyebrow: "Complete guide",
      title: `${scoped} complete details`,
      description:
        "Review the full loan information in one place before applying.",
      content: [
        `${scoped} is designed for ${product.purpose}. The page covers eligibility, features, documents, EMI planning, fees, reviews, and common questions.`,
        "Use the complete view when you want the full context before continuing into the assisted Fintaraa application journey.",
      ],
      bullets: [
        `Indicative amount: ${product.amountHint}.`,
        secureNote,
        "Keep KYC, bank statement, and income or asset documents ready.",
      ],
      faqs,
      filterKeys: ["all_details", "complete_guide", "loan_details"],
      sortOrder: 0,
      isActive: true,
    },
    {
      key: "overview",
      label: "Overview",
      eyebrow: "Loan guide",
      title: `${scoped} overview`,
      description:
        "Understand the product fit, common use cases, and application readiness before submitting details.",
      content: [
        `${product.name} can help with ${product.purpose}. Final approval and offer terms depend on partner underwriting.`,
        "Fintaraa helps organise applicant details, documents, and callbacks so the next steps are easier to track.",
      ],
      bullets: [
        "Compare requirements before applying.",
        "Prepare income, banking, and KYC details in advance.",
        "Avoid duplicate applications by following one assisted flow.",
      ],
      stats: [
        { label: "Journey", value: "Digital" },
        { label: "Support", value: "Assisted" },
        { label: "Location", value: "Mapped" },
      ],
      filterKeys: ["overview", "loan_guide"],
      sortOrder: 1,
      isActive: true,
    },
    {
      key: "features",
      label: "Features",
      eyebrow: "Highlights",
      title: `${product.name} features`,
      description:
        "Features vary by partner, applicant profile, amount, tenure, and city serviceability.",
      bullets: [
        `Purpose-led support for ${product.purpose}.`,
        `Indicative amount range or limit: ${product.amountHint}.`,
        "Guided application and document readiness support.",
        secureNote,
        "Partner comparison based on profile and serviceable location.",
        "Transparent next steps for verification and follow-up.",
      ],
      filterKeys: ["features", "benefits"],
      sortOrder: 2,
      isActive: true,
    },
    {
      key: "eligibility",
      label: "Eligibility",
      eyebrow: "Applicant fit",
      title: `${product.name} eligibility`,
      description:
        "Eligibility depends on income, repayment capacity, bureau behaviour, location, and partner policy.",
      bullets: [
        "Applicant should have valid PAN, Aadhaar or accepted identity proof, and active mobile number.",
        "Stable salary, business income, agricultural cash flow, or eligible repayment source may be required.",
        "Credit history, banking behaviour, and current EMI obligations are reviewed by partners.",
        secureNote,
      ],
      filterKeys: ["eligibility", "income", "credit_score"],
      sortOrder: 3,
      isActive: true,
    },
    {
      key: "documents",
      label: "Documents",
      eyebrow: "Checklist",
      title: `Documents required for ${scoped}`,
      description:
        "Exact documents vary by partner and applicant type, but the following list helps users prepare early.",
      bullets: [
        "PAN card and Aadhaar, passport, voter ID, or driving licence.",
        "Current address proof and service pincode.",
        "Recent bank statement, salary slips, ITR, GST returns, or business proof where applicable.",
        "Property, vehicle, gold, machinery, invoice, security, or land documents where the product is secured.",
        "Passport-size photograph and signed application declarations.",
      ],
      filterKeys: ["documents", "kyc", "income_proof"],
      sortOrder: 4,
      isActive: true,
    },
    {
      key: "emi_calculator",
      label: "EMI Calculator",
      eyebrow: "Repayment view",
      title: `${product.name} EMI calculator`,
      description:
        "Estimate EMI comfort before applying by comparing amount, tenure, rate range, and repayment capacity.",
      bullets: [
        "Choose an amount that keeps EMI comfortable after fixed monthly expenses.",
        "Shorter tenure can reduce total interest but raises monthly EMI.",
        "Longer tenure can reduce EMI but increases total repayment.",
        "Review affordability before accepting any offer.",
      ],
      filterKeys: ["emi_calculator", "emi", "repayment"],
      sortOrder: 5,
      isActive: true,
    },
    {
      key: "fees_and_charges",
      label: "Fees & Charges",
      eyebrow: "Cost view",
      title: `${product.name} fees and charges`,
      description:
        "Review charges before accepting an offer because final pricing can differ by lender and applicant profile.",
      bullets: [
        "Processing fee can be fixed or a percentage of the sanctioned amount.",
        "Stamp duty, legal, valuation, documentation, or technical charges may apply where relevant.",
        "Late payment, EMI bounce, foreclosure, and part-payment terms should be checked upfront.",
        "Ask for total payable amount, not only monthly EMI.",
      ],
      filterKeys: ["fees_and_charges", "processing_fee", "repayment"],
      sortOrder: 6,
      isActive: true,
    },
    {
      key: "reviews",
      label: "Reviews",
      eyebrow: "Customer view",
      title: `${product.name} reviews`,
      description:
        "Customer journeys are smoother when eligibility and document requirements are clear before lender review.",
      bullets: [
        "Users prefer having a document checklist before the callback.",
        "Assisted comparison helps them understand repayment comfort.",
        "Location-aware support reduces confusion around serviceability.",
      ],
      filterKeys: ["reviews", "testimonials"],
      sortOrder: 7,
      isActive: true,
    },
    {
      key: "faqs",
      label: "FAQs",
      eyebrow: "Common questions",
      title: `${product.name} FAQs`,
      description: `Common questions about ${product.name} eligibility, documents, and repayment.`,
      bullets: [
        "Quick answers before starting the application.",
        "Clarity on documents, city support, and approval timelines.",
        "Better preparation before lender verification.",
      ],
      faqs,
      filterKeys: ["faqs", "questions"],
      sortOrder: 8,
      isActive: true,
    },
  ];
};

const buildLoanFormFields = (product: LoanProductSeed) => [
  {
    key: "fullName",
    label: "Full name",
    type: "text",
    placeholder: "Enter full name",
    required: true,
    filterKey: "full_name",
    sortOrder: 1,
    isActive: true,
  },
  {
    key: "mobile",
    label: "Mobile number",
    type: "tel",
    placeholder: "10-digit mobile",
    required: true,
    filterKey: "mobile",
    sortOrder: 2,
    isActive: true,
  },
  {
    key: "loanAmount",
    label: "Loan amount",
    type: "number",
    placeholder: product.amountHint,
    required: true,
    filterKey: "loan_amount",
    sortOrder: 3,
    isActive: true,
  },
  {
    key: "employmentType",
    label: "Income type",
    type: "select",
    options: ["Salaried", "Self-employed", "Business owner", "Farmer", "Other"],
    placeholder: "Select income type",
    required: true,
    filterKey: "employment_type",
    sortOrder: 4,
    isActive: true,
  },
  {
    key: "pincode",
    label: "Pincode",
    type: "text",
    placeholder: "Service pincode",
    required: true,
    filterKey: "pincode",
    sortOrder: 5,
    isActive: true,
  },
  {
    key: "city",
    label: "City",
    type: "text",
    placeholder: "City",
    required: false,
    filterKey: "city",
    sortOrder: 6,
    isActive: true,
  },
];

const buildInsuranceTabs = (
  product: InsuranceProductSeed,
  scoped: string,
) => {
  const faqs = [
    {
      question: `What does ${product.name} usually cover?`,
      answer:
        "Coverage depends on the insurer, plan variant, policy wording, waiting periods, exclusions, and declared details. Always review the policy document before payment.",
    },
    {
      question: `Can I compare ${product.name} plans online?`,
      answer:
        "Yes, Fintaraa helps collect basic requirements so users can compare partner options and continue with a guided enquiry.",
    },
    {
      question: `What documents are needed for ${product.name}?`,
      answer:
        "KYC, mobile number, address, previous policy details, and product-specific declarations may be required based on the insurance category.",
    },
  ];

  return [
    {
      key: "coverage",
      label: "Coverage",
      title: `${scoped} coverage`,
      description: `Compare coverage for ${product.coverageFocus}.`,
      covered: [
        "Covered events listed in the policy wording.",
        "Claim assistance and document guidance where available.",
        "Partner plan comparison based on declared requirements.",
        "Renewal or new policy support based on category.",
      ],
      notCovered: [
        "Waiting period exclusions.",
        "Undeclared pre-existing or prior risks.",
        "Claims outside policy limits, terms, or geography.",
        "Non-covered expenses listed in the policy wording.",
      ],
      filterKeys: ["coverage", "covered", "not_covered"],
      sortOrder: 1,
      isActive: true,
    },
    {
      key: "compare_plans",
      label: "Compare Plans",
      title: `${product.name} plan comparison`,
      description:
        "Compare premium, coverage limits, claim process, exclusions, and renewal terms before selecting a plan.",
      bullets: [
        "Review sum insured or cover amount.",
        "Compare waiting periods, deductibles, and exclusions.",
        "Check network, claim support, and renewal conditions.",
      ],
      filterKeys: ["compare", "premium", "plans"],
      sortOrder: 2,
      isActive: true,
    },
    {
      key: "eligibility",
      label: "Eligibility",
      title: `${product.name} eligibility`,
      description:
        "Eligibility depends on age, city, declarations, sum insured, asset details, business details, or travel details as applicable.",
      bullets: [
        "Valid KYC and mobile number.",
        "Accurate city, pincode, and address details.",
        "Health, asset, vehicle, travel, shop, group, or business declarations as relevant.",
      ],
      filterKeys: ["eligibility", "declarations"],
      sortOrder: 3,
      isActive: true,
    },
    {
      key: "documents",
      label: "Documents",
      title: `${product.name} documents`,
      description:
        "The exact checklist depends on insurer and policy type, but these details are commonly requested.",
      bullets: [
        "Identity, address, and contact details.",
        "Previous policy copy for renewals.",
        "Medical, asset, invoice, vehicle, travel, or business documents where applicable.",
        "Nominee and claim support details when required.",
      ],
      filterKeys: ["documents", "kyc", "policy_copy"],
      sortOrder: 4,
      isActive: true,
    },
    {
      key: "claims",
      label: "Claims",
      title: `${product.name} claim process`,
      description:
        "Claim steps vary by insurer, but early intimation and complete documents are important.",
      bullets: [
        "Inform the insurer or support team quickly after a covered event.",
        "Keep bills, reports, photographs, FIR, invoices, or discharge summary as applicable.",
        "Track claim status and respond to insurer queries on time.",
      ],
      filterKeys: ["claims", "claim_process"],
      sortOrder: 5,
      isActive: true,
    },
    {
      key: "reviews",
      label: "Reviews",
      title: `${product.name} customer reviews`,
      description:
        "Users usually compare insurance better when coverage, exclusions, and claim steps are explained upfront.",
      bullets: [
        "Clear cover comparison helps avoid choosing only by premium.",
        "Document guidance helps reduce claim and issuance delays.",
        "Guided enquiries help users understand next steps.",
      ],
      filterKeys: ["reviews", "testimonials"],
      sortOrder: 6,
      isActive: true,
    },
    {
      key: "faqs",
      label: "FAQs",
      title: `${product.name} FAQs`,
      description: "Common questions before buying or renewing a policy.",
      bullets: [
        "Check coverage, documents, and claim process.",
        "Understand exclusions and waiting periods.",
        "Compare plans before payment.",
      ],
      faqs,
      filterKeys: ["faqs", "questions"],
      sortOrder: 7,
      isActive: true,
    },
  ];
};

const buildInsuranceFormFields = () => [
  {
    key: "age",
    label: "Age of insured member",
    type: "number",
    placeholder: "Age",
    required: true,
    filterKey: "age",
    sortOrder: 1,
    isActive: true,
  },
  {
    key: "city",
    label: "City",
    type: "text",
    placeholder: "City",
    required: true,
    filterKey: "city",
    sortOrder: 2,
    isActive: true,
  },
  {
    key: "sumInsured",
    label: "Sum insured",
    type: "select",
    options: ["3L", "5L", "10L", "25L", "50L", "1Cr"],
    placeholder: "Select cover",
    required: true,
    filterKey: "sum_insured",
    sortOrder: 3,
    isActive: true,
  },
  {
    key: "mobile",
    label: "Mobile number",
    type: "tel",
    placeholder: "10-digit mobile",
    required: true,
    filterKey: "mobile",
    sortOrder: 4,
    isActive: true,
  },
];

const upsertLocations = async () => {
  const seededAreas: SeedLocation[] = [];
  let canWritePincodeAreaCollections = true;

  for (const block of locations) {
    const country = await Country.findOneAndUpdate(
      { name: block.country.name },
      block.country,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const state = await State.findOneAndUpdate(
      { name: block.state.name, countryId: country._id },
      { ...block.state, countryId: country._id },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    for (const cityInput of block.cities) {
      const city = await City.findOneAndUpdate(
        { name: cityInput.name, stateId: state._id },
        {
          name: cityInput.name,
          stateId: state._id,
          countryId: country._id,
          isCapital: cityInput.name === block.state.name,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      for (const pincodeInput of cityInput.pincodes) {
        const pincode = canWritePincodeAreaCollections
          ? await Pincode.findOneAndUpdate(
              { code: pincodeInput.code, cityId: city._id },
              {
                code: pincodeInput.code,
                cityId: city._id,
                stateId: state._id,
                countryId: country._id,
              },
              { upsert: true, new: true, setDefaultsOnInsert: true },
            ).catch((error) => {
              if (error?.code === 8000) {
                canWritePincodeAreaCollections = false;
                console.warn(
                  "Skipping pincode/area collection seed: MongoDB collection limit reached.",
                );
                return null;
              }
              throw error;
            })
          : null;

        for (const areaName of pincodeInput.areas) {
          if (canWritePincodeAreaCollections && pincode) {
            await Area.findOneAndUpdate(
              { name: areaName, pincodeId: pincode._id },
              {
                name: areaName,
                pincodeId: pincode._id,
                cityId: city._id,
                stateId: state._id,
                countryId: country._id,
              },
              { upsert: true, new: true, setDefaultsOnInsert: true },
            );
          }

          seededAreas.push({
            country: block.country.name,
            state: block.state.name,
            city: cityInput.name,
            pincode: pincodeInput.code,
            area: areaName,
          });
        }
      }
    }
  }

  return seededAreas;
};

const buildLoanPlans = (seededAreas: SeedLocation[]) => {
  const plans: Array<{ product: LoanProductSeed; location: SeedLocation }> = [];
  const seen = new Set<string>();

  const append = (product: LoanProductSeed, location: SeedLocation) => {
    const key = `${product.slug}:${location.country}:${location.state}:${location.city}:${location.pincode}:${location.area}`;
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ product, location });
  };

  loanProducts.forEach((product) => {
    append(product, baseLocation);
    seededAreas.forEach((location) => append(product, location));
  });

  append(
    loanProducts[0],
    findLocation(seededAreas, "New Delhi", "Connaught Place"),
  );
  append(loanProducts[0], findLocation(seededAreas, "Mumbai", "Andheri West"));
  append(
    loanProducts.find((product) => product.slug === "home-loan")!,
    findLocation(seededAreas, "New Delhi", "Karol Bagh"),
  );
  append(
    loanProducts.find((product) => product.slug === "home-loan")!,
    findLocation(seededAreas, "Mumbai", "Fort"),
  );
  append(
    loanProducts.find((product) => product.slug === "business-loan")!,
    findLocation(seededAreas, "Mumbai", "Bandra Kurla Complex"),
  );

  return plans;
};

const buildInsurancePlans = (seededAreas: SeedLocation[]) => {
  const plans: Array<{
    product: InsuranceProductSeed;
    location: SeedLocation;
  }> = [];
  const seen = new Set<string>();

  const append = (product: InsuranceProductSeed, location: SeedLocation) => {
    const key = `${product.slug}:${location.country}:${location.state}:${location.city}:${location.pincode}:${location.area}`;
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ product, location });
  };

  insuranceProducts.forEach((product) => {
    append(product, baseLocation);
    seededAreas.forEach((location) => append(product, location));
  });

  return plans;
};

const runBulkWrites = async (
  model: typeof LoanSeoPage | typeof InsuranceSeoPage,
  operations: any[],
) => {
  const chunkSize = 250;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const chunk = operations.slice(index, index + chunkSize);
    if (chunk.length) {
      await (model as any).bulkWrite(chunk, { ordered: false });
    }
  }
};

const upsertSeoPages = async (seededAreas: SeedLocation[]) => {
  const loanPlans = expandPlanLocations(
    buildLoanPlans(seededAreas),
    (product) => product.slug,
  );
  const insurancePlans = expandPlanLocations(
    buildInsurancePlans(seededAreas),
    (product) => product.slug,
  );
  let skippedByCollectionLimit = false;
  let loanPages = 0;
  let insurancePages = 0;

  const loanOperations = loanPlans.map(({ product, location }, index) => {
    const scopedLoan = scopedProductName(product.name, location);
    return {
      updateOne: {
        filter: locationQuery("loanTypeSlug", product.slug, location),
        update: {
          $set: {
            loanType: product.name,
            loanTypeSlug: product.slug,
            title: scopedLoan,
            subtitle: `${location.city ? "Location-specific" : "Complete"} guide for ${product.name.toLowerCase()} eligibility, documents, EMI, and fees.`,
            heroTitle: `${scopedLoan} made easier`,
            heroDescription: `Compare ${product.name.toLowerCase()} requirements${cityPhrase(location)}, prepare documents, and continue with guided Fintaraa support.`,
            seoTitle: `${scopedLoan} | Eligibility, Documents, EMI | Fintaraa`,
            seoDescription: `Apply for ${scopedLoan} with Fintaraa. Review eligibility, features, documents, EMI calculator, fees and charges, reviews, and FAQs.`,
            canonicalPath: canonicalPath(product.slug, location),
            location,
            badges: [
              "SEO ready",
              location.city ? "Location page" : "Product page",
              "Assisted journey",
            ],
            filterKeys: [
              "all_details",
              "overview",
              "features",
              "eligibility",
              "documents",
              "emi_calculator",
              "fees_and_charges",
              "reviews",
              "faqs",
            ],
            tabs: buildLoanTabs(product, scopedLoan),
            formFields: buildLoanFormFields(product),
            status: LoanSeoPageStatus.ACTIVE,
            isIndexable: true,
            isFeatured:
              product.slug === "personal-loan" || product.slug === "home-loan",
            priority: 10 + index,
            publishedAt: new Date(now.getTime() - index * 3600000),
          },
        },
        upsert: true,
      },
    };
  });

  const insuranceOperations = insurancePlans.map(
    ({ product, location }, index) => {
      const scopedInsurance = scopedProductName(product.name, location);
      return {
        updateOne: {
          filter: locationQuery("insuranceTypeSlug", product.slug, location),
          update: {
            $set: {
              insuranceType: product.name,
              insuranceTypeSlug: product.slug,
              title: scopedInsurance,
              subtitle: `${location.city ? "Location-specific" : "Complete"} guide for ${product.name.toLowerCase()} coverage, premium, documents, and claims.`,
              heroTitle: `${scopedInsurance} plans`,
              heroDescription: `Compare ${product.name.toLowerCase()} options${cityPhrase(location)} with clear coverage, exclusions, and claim guidance.`,
              seoTitle: `${scopedInsurance} | Coverage, Premium, Claims | Fintaraa`,
              seoDescription: `Compare ${scopedInsurance} with Fintaraa. Review coverage, premiums, eligibility, documents, claims, reviews, and FAQs.`,
              canonicalPath: canonicalPath(product.slug, location),
              location,
              badges: [
                "SEO ready",
                location.city ? "Location page" : "Product page",
                "Coverage guide",
              ],
              filterKeys: [
                "coverage",
                "compare_plans",
                "eligibility",
                "documents",
                "claims",
                "reviews",
                "faqs",
              ],
              tabs: buildInsuranceTabs(product, scopedInsurance),
              formFields: buildInsuranceFormFields(),
              status: InsuranceSeoPageStatus.ACTIVE,
              isIndexable: true,
              isFeatured:
                product.slug === "health-insurance" ||
                product.slug === "term-insurance",
              priority: 100 + index,
              publishedAt: new Date(now.getTime() - index * 3600000),
            },
          },
          upsert: true,
        },
      };
    },
  );

  try {
    await runBulkWrites(LoanSeoPage, loanOperations);
    loanPages = loanOperations.length;

    await runBulkWrites(InsuranceSeoPage, insuranceOperations);
    insurancePages = insuranceOperations.length;
  } catch (error: any) {
    if (error?.code === 8000) {
      skippedByCollectionLimit = true;
    } else {
      throw error;
    }
  }

  return {
    loanPages,
    insurancePages,
    skippedByCollectionLimit,
  };
};

const seed = async () => {
  try {
    await connectDB();

    const seededAreas = await upsertLocations();
    const seoCounts = await upsertSeoPages(seededAreas);

    console.log(
      `Seeded SEO content: ${seededAreas.length} areas, ${seoCounts.loanPages} loan pages, ${seoCounts.insurancePages} insurance pages.`,
    );
    if (seoCounts.skippedByCollectionLimit) {
      console.warn(
        "SEO page seed skipped because MongoDB Atlas is already at 500/500 collections. Free collection capacity or pre-create the SEO page collections, then rerun npm run seed:seo-content.",
      );
    }
  } catch (error) {
    console.error("SEO content seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
