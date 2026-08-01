import "dotenv/config";
import mongoose, { Types } from "mongoose";
import connectDB from "../config/database";
import { Banker } from "../modals/banker.model";
import {
  BankProduct,
  BankProductStatus,
} from "../modals/bankProduct.model";
import {
  EligibilityAmountType,
  EligibilityCriteria,
  EligibilityCriteriaStatus,
} from "../modals/eligibilityCriteria.model";
import {
  BankSeoPage,
  BankSeoPageStatus,
} from "../modals/bankSeoPage.model";
import {
  Partner,
  PartnerIntegrationStatus,
  PartnerProductCategory,
  PartnerStatus,
  PartnerType,
  normalizePartnerSlug,
} from "../modals/partner.model";
import {
  PartnerFeeType,
  PartnerIncomePeriod,
  PartnerProduct,
  PartnerProductOrigin,
  normalizePartnerProductCode,
} from "../modals/partnerProduct.model";

const PARTNER_MIGRATION_VERSION = 2;
const ASSIGNMENT_POLICY_VERSION = 1;

type LegacyRecord = Record<string, any> & { _id: Types.ObjectId };

type PartnerSeed = {
  name: string;
  slug: string;
  type: PartnerType;
  logo: string;
  description: string;
  active: boolean;
  featured: boolean;
  priority: number;
  contacts: Array<Record<string, any>>;
  categories: Set<PartnerProductCategory>;
  states: Set<string>;
  cities: Set<string>;
  pincodes: Set<string>;
  bankerIds: Set<string>;
  bankProductIds: Set<string>;
  eligibilityCriteriaIds: Set<string>;
  bankSeoPageIds: Set<string>;
};

type ProductSeed = {
  partnerSlug: string;
  category: PartnerProductCategory;
  productType: string;
  code: string;
  name: string;
  description: string;
  interestRates: number[];
  processingFee?: { type: PartnerFeeType; value?: number };
  amountMin?: number;
  amountMax?: number;
  tenureMinMonths?: number;
  tenureMaxMonths?: number;
  cibilValues: number[];
  incomeValues: number[];
  incomePeriod: PartnerIncomePeriod;
  employmentTypes: Set<string>;
  ageMinValues: number[];
  ageMaxValues: number[];
  companyCategories: Set<string>;
  active: boolean;
  published: boolean;
  priority: number;
  origins: Set<PartnerProductOrigin>;
  bankerIds: Set<string>;
  bankProductIds: Set<string>;
  eligibilityCriteriaIds: Set<string>;
  bankSeoPageIds: Set<string>;
};

const normalizedNameKey = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const CANONICAL_NAMES = new Map<string, string>([
  ["hdfc", "HDFC Bank"],
  ["hdfc bank", "HDFC Bank"],
  ["icici", "ICICI Bank"],
  ["icici bank", "ICICI Bank"],
  ["sbi", "State Bank of India"],
  ["state bank of india", "State Bank of India"],
  ["axis", "Axis Bank"],
  ["axis bank", "Axis Bank"],
  ["kotak", "Kotak Mahindra Bank"],
  ["kotak bank", "Kotak Mahindra Bank"],
  ["kotak mahindra bank", "Kotak Mahindra Bank"],
  ["idfc", "IDFC FIRST Bank"],
  ["idfc bank", "IDFC FIRST Bank"],
  ["idfc first", "IDFC FIRST Bank"],
  ["idfc first bank", "IDFC FIRST Bank"],
  ["bob", "Bank of Baroda"],
  ["bank of baroda", "Bank of Baroda"],
  ["pnb", "Punjab National Bank"],
  ["punjab national bank", "Punjab National Bank"],
  ["yes", "Yes Bank"],
  ["yes bank", "Yes Bank"],
  ["indusind", "IndusInd Bank"],
  ["indusind bank", "IndusInd Bank"],
  ["federal", "Federal Bank"],
  ["federal bank", "Federal Bank"],
  ["au bank", "AU Small Finance Bank"],
  ["au small finance bank", "AU Small Finance Bank"],
  ["bajaj finserv", "Bajaj Finserv"],
  ["bajaj finance", "Bajaj Finance"],
  ["tata capital", "Tata Capital"],
  ["l and t finance", "L&T Finance"],
  ["lt finance", "L&T Finance"],
]);

const KNOWN_NBFCS = new Set(
  [
    "Bajaj Finserv",
    "Bajaj Finance",
    "Tata Capital",
    "L&T Finance",
    "Aditya Birla Finance",
    "Shriram Finance",
    "Muthoot Finance",
    "Manappuram Finance",
    "Cholamandalam Investment and Finance",
    "Poonawalla Fincorp",
    "Hero FinCorp",
    "IIFL Finance",
  ].map(normalizedNameKey),
);

const KNOWN_INSURERS = new Set(
  [
    "HDFC Life Insurance",
    "ICICI Prudential Life Insurance",
    "ICICI Lombard General Insurance",
    "SBI Life Insurance",
    "Bajaj Allianz Life Insurance",
    "Bajaj Allianz General Insurance",
    "Max Life Insurance",
    "Tata AIG General Insurance",
    "Star Health and Allied Insurance",
    "Life Insurance Corporation of India",
  ].map(normalizedNameKey),
);

const INVALID_PARTNER_NAMES = new Set(["", "jamalia gibbs", "n a", "na"]);

const canonicalPartnerName = (value: unknown) => {
  const original = String(value || "").trim().replace(/\s+/g, " ");
  const key = normalizedNameKey(original);
  if (INVALID_PARTNER_NAMES.has(key)) return "";
  return CANONICAL_NAMES.get(key) || original;
};

const inferPartnerType = (name: string) => {
  const key = normalizedNameKey(name);
  if (
    KNOWN_INSURERS.has(key) ||
    /\b(insurance|life assurance|general assurance)\b/.test(key)
  ) {
    return PartnerType.INSURER;
  }
  if (KNOWN_NBFCS.has(key)) return PartnerType.NBFC;
  return PartnerType.BANK;
};

const titleFromToken = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const asNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const numbersFromText = (value: unknown) =>
  (String(value || "").match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(Number.isFinite);

const categoryFromProduct = (value: unknown) => {
  const token = normalizedNameKey(value);
  if (/\b(card|credit card)\b/.test(token)) {
    return PartnerProductCategory.CREDIT_CARD;
  }
  if (
    /\b(insurance|policy|health cover|life cover|term plan)\b/.test(token)
  ) {
    return PartnerProductCategory.INSURANCE;
  }
  return PartnerProductCategory.LOAN;
};

const normalizeEmployment = (value: unknown) => {
  const token = normalizedNameKey(value).replace(/\s+/g, "");
  if (["salary", "salaried"].includes(token)) return "salaried";
  if (token.includes("professional")) return "self_employed_professional";
  if (token.includes("selfemployed") || token.includes("business")) {
    return "self_employed";
  }
  return normalizePartnerProductCode(value);
};

const getOrCreatePartnerSeed = (
  seeds: Map<string, PartnerSeed>,
  rawName: unknown,
) => {
  const name = canonicalPartnerName(rawName);
  if (!name) return null;
  const slug = normalizePartnerSlug(name);
  let seed = seeds.get(slug);
  if (!seed) {
    seed = {
      name,
      slug,
      type: inferPartnerType(name),
      logo: "",
      description: "",
      active: false,
      featured: false,
      priority: 100,
      contacts: [],
      categories: new Set(),
      states: new Set(),
      cities: new Set(),
      pincodes: new Set(),
      bankerIds: new Set(),
      bankProductIds: new Set(),
      eligibilityCriteriaIds: new Set(),
      bankSeoPageIds: new Set(),
    };
    seeds.set(slug, seed);
  }
  return seed;
};

const getOrCreateProductSeed = (
  seeds: Map<string, ProductSeed>,
  args: {
    partnerSlug: string;
    category: PartnerProductCategory;
    productType: string;
    code: string;
    name: string;
  },
) => {
  const code = normalizePartnerProductCode(args.code);
  const key = `${args.partnerSlug}|${code}`;
  let seed = seeds.get(key);
  if (!seed) {
    seed = {
      partnerSlug: args.partnerSlug,
      category: args.category,
      productType: normalizePartnerProductCode(args.productType),
      code,
      name: args.name,
      description: "",
      interestRates: [],
      cibilValues: [],
      incomeValues: [],
      incomePeriod: PartnerIncomePeriod.MONTHLY,
      employmentTypes: new Set(),
      ageMinValues: [],
      ageMaxValues: [],
      companyCategories: new Set(),
      active: false,
      published: false,
      priority: 100,
      origins: new Set(),
      bankerIds: new Set(),
      bankProductIds: new Set(),
      eligibilityCriteriaIds: new Set(),
      bankSeoPageIds: new Set(),
    };
    seeds.set(key, seed);
  }
  return seed;
};

const eachObjectId = (values: Set<string>) =>
  Array.from(values).map((value) => new Types.ObjectId(value));

const minimum = (values: number[]) =>
  values.length ? Math.min(...values) : undefined;

const maximum = (values: number[]) =>
  values.length ? Math.max(...values) : undefined;

const productOrigin = (seed: ProductSeed) => {
  const origins = Array.from(seed.origins);
  if (origins.length === 1) return origins[0];
  return origins.length > 1
    ? PartnerProductOrigin.LEGACY_MIXED
    : PartnerProductOrigin.MANUAL;
};

async function migratePartners() {
  await connectDB();

  const [bankers, bankProducts, criteria, seoPages] = (await Promise.all([
    Banker.find({}).lean(),
    BankProduct.find({}).lean(),
    EligibilityCriteria.find({}).lean(),
    BankSeoPage.find({})
      .select(
        "bankName bankSlug logoUrl aboutDescription productName productSlug location interestRates status isFeatured priority",
      )
      .lean(),
  ])) as [LegacyRecord[], LegacyRecord[], LegacyRecord[], LegacyRecord[]];

  const partnerSeeds = new Map<string, PartnerSeed>();
  const productSeeds = new Map<string, ProductSeed>();
  const skippedNames = new Set<string>();

  for (const banker of bankers) {
    const partner = getOrCreatePartnerSeed(partnerSeeds, banker.name);
    if (!partner) {
      skippedNames.add(String(banker.name || ""));
      continue;
    }
    partner.bankerIds.add(String(banker._id));
    partner.logo ||= String(banker.logo || "").trim();
    partner.description ||= String(banker.about || "").trim();
    partner.active ||= banker.status === "active";
    partner.priority = Math.min(partner.priority, Number(banker.priority || 100));
    const location = String(banker.location || "").trim();
    if (location) partner.cities.add(location);
    if (banker.managerName) {
      const contact = {
        name: String(banker.managerName).trim(),
        role: String(banker.managerRole || "Relationship Manager").trim(),
        email: String(banker.managerEmail || "").trim().toLowerCase(),
        phone: String(banker.managerPhone || "").trim(),
        isPrimary: partner.contacts.length === 0,
      };
      if (
        !partner.contacts.some(
          (item) =>
            normalizedNameKey(item.email || item.name) ===
            normalizedNameKey(contact.email || contact.name),
        )
      ) {
        partner.contacts.push(contact);
      }
    }
    for (const rawProduct of banker.products || []) {
      const name = String(rawProduct || "").trim();
      if (!name) continue;
      const category = categoryFromProduct(name);
      partner.categories.add(category);
      const product = getOrCreateProductSeed(productSeeds, {
        partnerSlug: partner.slug,
        category,
        productType: name,
        code: `catalog_${normalizePartnerProductCode(name)}`,
        name,
      });
      product.active ||= banker.status === "active";
      product.published ||= banker.status === "active";
      product.priority = Math.min(product.priority, Number(banker.priority || 100));
      product.origins.add(PartnerProductOrigin.LEGACY_BANKER);
      product.bankerIds.add(String(banker._id));
    }
  }

  for (const legacy of bankProducts) {
    const partner = getOrCreatePartnerSeed(partnerSeeds, legacy.bankName);
    if (!partner) {
      skippedNames.add(String(legacy.bankName || ""));
      continue;
    }
    const category = categoryFromProduct(`${legacy.type || ""} ${legacy.name || ""}`);
    partner.categories.add(category);
    partner.bankProductIds.add(String(legacy._id));
    partner.active ||= legacy.status === BankProductStatus.ACTIVE;
    const product = getOrCreateProductSeed(productSeeds, {
      partnerSlug: partner.slug,
      category,
      productType: legacy.type || category,
      code: `legacy_${category}_${String(legacy._id)}`,
      name: String(legacy.name || legacy.title || "Legacy product").trim(),
    });
    product.description ||= String(legacy.shortDescription || legacy.subtitle || "").trim();
    product.active ||= legacy.status === BankProductStatus.ACTIVE;
    product.published ||= legacy.status === BankProductStatus.ACTIVE;
    product.priority = Math.min(
      product.priority,
      Number(legacy.priorityOrder || legacy.rank || 100),
    );
    product.origins.add(PartnerProductOrigin.LEGACY_BANK_PRODUCT);
    product.bankProductIds.add(String(legacy._id));
    const cibil = asNumber(legacy.creditScoreRequirement);
    const income = asNumber(legacy.minimumIncome);
    if (cibil !== undefined) product.cibilValues.push(cibil);
    if (income !== undefined) product.incomeValues.push(income);
    const fee = asNumber(legacy.joiningFee ?? legacy.annualFee);
    if (fee !== undefined) product.processingFee = { type: PartnerFeeType.FLAT, value: fee };
  }

  for (const legacy of criteria) {
    const partner = getOrCreatePartnerSeed(partnerSeeds, legacy.bankName);
    if (!partner) {
      skippedNames.add(String(legacy.bankName || ""));
      continue;
    }
    partner.categories.add(PartnerProductCategory.LOAN);
    partner.eligibilityCriteriaIds.add(String(legacy._id));
    partner.active ||= legacy.status === EligibilityCriteriaStatus.ACTIVE;
    const employmentType = normalizeEmployment(legacy.salaryType) || "all";
    const productType = normalizePartnerProductCode(legacy.loanType);
    const product = getOrCreateProductSeed(productSeeds, {
      partnerSlug: partner.slug,
      category: PartnerProductCategory.LOAN,
      productType,
      code: `eligibility_${productType}_${employmentType}`,
      name: `${titleFromToken(legacy.loanType)} — ${titleFromToken(legacy.salaryType)}`,
    });
    product.active ||= legacy.status === EligibilityCriteriaStatus.ACTIVE;
    product.published ||= legacy.status === EligibilityCriteriaStatus.ACTIVE;
    product.origins.add(PartnerProductOrigin.LEGACY_ELIGIBILITY);
    product.eligibilityCriteriaIds.add(String(legacy._id));
    product.employmentTypes.add(employmentType);
    const roi = asNumber(legacy.roi);
    const cibil = asNumber(legacy.cibilScore);
    const income = asNumber(legacy.netSalary);
    const ageMin = asNumber(legacy.minAge);
    const ageMax = asNumber(legacy.maxAge);
    const maximumAmount = asNumber(legacy.maximumLoanAmount);
    const maximumTenure = asNumber(legacy.maxTenureYears);
    if (roi !== undefined) product.interestRates.push(roi);
    if (cibil !== undefined) product.cibilValues.push(cibil);
    if (income !== undefined) product.incomeValues.push(income);
    if (ageMin !== undefined) product.ageMinValues.push(ageMin);
    if (ageMax !== undefined) product.ageMaxValues.push(ageMax);
    if (maximumAmount !== undefined) product.amountMax = maximumAmount;
    if (maximumTenure !== undefined) product.tenureMaxMonths = maximumTenure * 12;
    for (const category of legacy.companyCategory || []) {
      if (String(category || "").trim()) {
        product.companyCategories.add(String(category).trim());
      }
    }
    const processingFee = asNumber(legacy.processingFees);
    if (processingFee !== undefined) {
      product.processingFee = {
        type:
          legacy.processingFeesType === EligibilityAmountType.PERCENTAGE
            ? PartnerFeeType.PERCENTAGE
            : PartnerFeeType.FLAT,
        value: processingFee,
      };
    }
  }

  for (const legacy of seoPages) {
    const partner = getOrCreatePartnerSeed(partnerSeeds, legacy.bankName);
    if (!partner) {
      skippedNames.add(String(legacy.bankName || ""));
      continue;
    }
    const category = categoryFromProduct(legacy.productName);
    partner.categories.add(category);
    partner.bankSeoPageIds.add(String(legacy._id));
    partner.logo ||= String(legacy.logoUrl || "").trim();
    partner.description ||= String(legacy.aboutDescription || "").trim();
    partner.active ||= legacy.status === BankSeoPageStatus.ACTIVE;
    partner.featured ||= Boolean(legacy.isFeatured);
    partner.priority = Math.min(partner.priority, Number(legacy.priority || 100));
    const location = legacy.location || {};
    if (String(location.state || "").trim()) partner.states.add(String(location.state).trim());
    if (String(location.city || "").trim()) partner.cities.add(String(location.city).trim());
    if (String(location.pincode || "").trim()) {
      partner.pincodes.add(String(location.pincode).trim().replace(/\s+/g, ""));
    }
    const productType = normalizePartnerProductCode(legacy.productSlug || legacy.productName);
    const product = getOrCreateProductSeed(productSeeds, {
      partnerSlug: partner.slug,
      category,
      productType,
      code: `seo_${productType}`,
      name: String(legacy.productName || titleFromToken(productType)).trim(),
    });
    product.active ||= legacy.status === BankSeoPageStatus.ACTIVE;
    product.published ||= legacy.status === BankSeoPageStatus.ACTIVE;
    product.priority = Math.min(product.priority, Number(legacy.priority || 100));
    product.origins.add(PartnerProductOrigin.LEGACY_SEO);
    product.bankSeoPageIds.add(String(legacy._id));
    for (const rate of legacy.interestRates || []) {
      const values = numbersFromText(rate.interestRate).filter(
        (value) => value >= 0 && value <= 100,
      );
      product.interestRates.push(...values);
      if (!product.processingFee && rate.processingFee) {
        const fee = numbersFromText(rate.processingFee)[0];
        if (fee !== undefined) {
          product.processingFee = {
            type: String(rate.processingFee).includes("%")
              ? PartnerFeeType.PERCENTAGE
              : PartnerFeeType.FLAT,
            value: fee,
          };
        }
      }
    }
  }

  const partnerOperations = Array.from(partnerSeeds.values()).map((seed) => {
    const addToSet: Record<string, any> = {};
    const addEach = (path: string, values: unknown[]) => {
      if (values.length) addToSet[path] = { $each: values };
    };
    addEach("productCategories", Array.from(seed.categories));
    addEach("serviceAreas.states", Array.from(seed.states));
    addEach("serviceAreas.cities", Array.from(seed.cities));
    addEach("serviceAreas.pincodes", Array.from(seed.pincodes));
    addEach("sourceReferences.bankerIds", eachObjectId(seed.bankerIds));
    addEach("sourceReferences.bankProductIds", eachObjectId(seed.bankProductIds));
    addEach(
      "sourceReferences.eligibilityCriteriaIds",
      eachObjectId(seed.eligibilityCriteriaIds),
    );
    addEach("sourceReferences.bankSeoPageIds", eachObjectId(seed.bankSeoPageIds));
    return {
      updateOne: {
        filter: { slug: seed.slug },
        update: {
          $setOnInsert: {
            name: seed.name,
            slug: seed.slug,
            type: seed.type,
            logo: seed.logo,
            description: seed.description,
            status: seed.active ? PartnerStatus.ACTIVE : PartnerStatus.INACTIVE,
            featured: seed.featured,
            priority: seed.priority,
            website: "",
            regulatoryIds: {},
            contacts: seed.contacts,
            "serviceAreas.countrywide":
              seed.states.size === 0 && seed.cities.size === 0 && seed.pincodes.size === 0,
            integrationStatus: PartnerIntegrationStatus.NOT_CONFIGURED,
            isDeleted: false,
            deletedAt: null,
          },
          ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
        },
        upsert: true,
      },
    };
  });

  const partnerResult = partnerOperations.length
    ? await Partner.bulkWrite(partnerOperations as any, { ordered: false })
    : null;
  const partnerDocuments = await Partner.find({
    slug: { $in: Array.from(partnerSeeds.keys()) },
  })
    .select("_id slug")
    .lean();
  const partnerIds = new Map(
    partnerDocuments.map((partner) => [partner.slug, partner._id]),
  );

  const productOperations = Array.from(productSeeds.values()).flatMap((seed) => {
    const partner = partnerIds.get(seed.partnerSlug);
    if (!partner || !seed.code || !seed.productType) return [];
    const addToSet: Record<string, any> = {};
    const addEach = (path: string, values: unknown[]) => {
      if (values.length) addToSet[path] = { $each: values };
    };
    addEach("sourceReferences.bankerIds", eachObjectId(seed.bankerIds));
    addEach("sourceReferences.bankProductIds", eachObjectId(seed.bankProductIds));
    addEach(
      "sourceReferences.eligibilityCriteriaIds",
      eachObjectId(seed.eligibilityCriteriaIds),
    );
    addEach("sourceReferences.bankSeoPageIds", eachObjectId(seed.bankSeoPageIds));
    const interestRateMin = minimum(seed.interestRates);
    const interestRateMax = maximum(seed.interestRates);
    const cibilMin = minimum(seed.cibilValues);
    const incomeMin = minimum(seed.incomeValues);
    const ageMin = minimum(seed.ageMinValues);
    const ageMax = maximum(seed.ageMaxValues);
    const assignmentEnabled =
      seed.category === PartnerProductCategory.LOAN &&
      seed.eligibilityCriteriaIds.size > 0;
    return [
      {
        updateOne: {
          filter: { partner, code: seed.code },
          update: {
            $setOnInsert: {
              partner,
              category: seed.category,
              productType: seed.productType,
              code: seed.code,
              name: seed.name,
              description: seed.description,
              interestRateMin,
              interestRateMax,
              processingFee: seed.processingFee || { type: PartnerFeeType.NONE },
              amountMin: seed.amountMin,
              amountMax: seed.amountMax,
              tenureMinMonths: seed.tenureMinMonths,
              tenureMaxMonths: seed.tenureMaxMonths,
              eligibility: {
                cibilMin,
                incomeMin,
                incomePeriod: seed.incomePeriod,
                employmentTypes: Array.from(seed.employmentTypes).filter(
                  (value) => value !== "all",
                ),
                ageMin,
                ageMax,
                cities: [],
                pincodes: [],
                companyCategories: Array.from(seed.companyCategories),
              },
              insurance: {},
              active: seed.active,
              published: seed.published,
              assignmentEnabled,
              priority: seed.priority,
              origin: productOrigin(seed),
              migrationVersion: PARTNER_MIGRATION_VERSION,
              assignmentPolicyVersion: ASSIGNMENT_POLICY_VERSION,
              isDeleted: false,
              deletedAt: null,
            },
            ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
          },
          upsert: true,
        },
      },
    ];
  });

  const productResult = productOperations.length
    ? await PartnerProduct.bulkWrite(productOperations as any, { ordered: false })
    : null;

  // Initialize only rows that predate assignmentEnabled. The $exists guard is
  // deliberate: a later admin choice (true or false) is never overwritten.
  const eligibilityPolicyResult = await PartnerProduct.updateMany(
    {
      assignmentEnabled: { $exists: false },
      category: PartnerProductCategory.LOAN,
      "sourceReferences.eligibilityCriteriaIds.0": { $exists: true },
    },
    {
      $set: {
        assignmentEnabled: true,
        origin: PartnerProductOrigin.LEGACY_ELIGIBILITY,
        migrationVersion: PARTNER_MIGRATION_VERSION,
        assignmentPolicyVersion: ASSIGNMENT_POLICY_VERSION,
      },
    },
  );
  const seoPolicyResult = await PartnerProduct.updateMany(
    {
      assignmentEnabled: { $exists: false },
      "sourceReferences.bankSeoPageIds.0": { $exists: true },
    },
    {
      $set: {
        assignmentEnabled: false,
        origin: PartnerProductOrigin.LEGACY_SEO,
        migrationVersion: PARTNER_MIGRATION_VERSION,
        assignmentPolicyVersion: ASSIGNMENT_POLICY_VERSION,
      },
    },
  );
  const bankProductPolicyResult = await PartnerProduct.updateMany(
    {
      assignmentEnabled: { $exists: false },
      "sourceReferences.bankProductIds.0": { $exists: true },
    },
    {
      $set: {
        assignmentEnabled: false,
        origin: PartnerProductOrigin.LEGACY_BANK_PRODUCT,
        migrationVersion: PARTNER_MIGRATION_VERSION,
        assignmentPolicyVersion: ASSIGNMENT_POLICY_VERSION,
      },
    },
  );
  const bankerPolicyResult = await PartnerProduct.updateMany(
    {
      assignmentEnabled: { $exists: false },
      $or: [
        { "sourceReferences.bankerIds.0": { $exists: true } },
        { code: /^catalog_/ },
      ],
    },
    {
      $set: {
        assignmentEnabled: false,
        origin: PartnerProductOrigin.LEGACY_BANKER,
        migrationVersion: PARTNER_MIGRATION_VERSION,
        assignmentPolicyVersion: ASSIGNMENT_POLICY_VERSION,
      },
    },
  );
  const manualPolicyResult = await PartnerProduct.updateMany(
    {
      assignmentEnabled: { $exists: false },
      $nor: [
        { "sourceReferences.bankerIds.0": { $exists: true } },
        { "sourceReferences.bankProductIds.0": { $exists: true } },
        { "sourceReferences.eligibilityCriteriaIds.0": { $exists: true } },
        { "sourceReferences.bankSeoPageIds.0": { $exists: true } },
        { code: /^(catalog_|legacy_|eligibility_|seo_)/ },
      ],
    },
    {
      $set: {
        assignmentEnabled: true,
        origin: PartnerProductOrigin.MANUAL,
        assignmentPolicyVersion: ASSIGNMENT_POLICY_VERSION,
      },
    },
  );
  // Provenance is metadata-only and can be backfilled even when an admin has
  // already chosen assignmentEnabled. The assignment boolean remains untouched.
  const eligibilityProvenanceResult = await PartnerProduct.updateMany(
    {
      origin: { $exists: false },
      "sourceReferences.eligibilityCriteriaIds.0": { $exists: true },
    },
    {
      $set: {
        origin: PartnerProductOrigin.LEGACY_ELIGIBILITY,
        migrationVersion: PARTNER_MIGRATION_VERSION,
      },
    },
  );
  const seoProvenanceResult = await PartnerProduct.updateMany(
    {
      origin: { $exists: false },
      "sourceReferences.bankSeoPageIds.0": { $exists: true },
    },
    {
      $set: {
        origin: PartnerProductOrigin.LEGACY_SEO,
        migrationVersion: PARTNER_MIGRATION_VERSION,
      },
    },
  );
  const bankProductProvenanceResult = await PartnerProduct.updateMany(
    {
      origin: { $exists: false },
      "sourceReferences.bankProductIds.0": { $exists: true },
    },
    {
      $set: {
        origin: PartnerProductOrigin.LEGACY_BANK_PRODUCT,
        migrationVersion: PARTNER_MIGRATION_VERSION,
      },
    },
  );
  const bankerProvenanceResult = await PartnerProduct.updateMany(
    {
      origin: { $exists: false },
      $or: [
        { "sourceReferences.bankerIds.0": { $exists: true } },
        { code: /^catalog_/ },
      ],
    },
    {
      $set: {
        origin: PartnerProductOrigin.LEGACY_BANKER,
        migrationVersion: PARTNER_MIGRATION_VERSION,
      },
    },
  );

  console.log(
    JSON.stringify(
      {
        source: {
          bankers: bankers.length,
          bankProducts: bankProducts.length,
          eligibilityCriteria: criteria.length,
          bankSeoPages: seoPages.length,
        },
        normalizedPartners: partnerSeeds.size,
        normalizedProducts: productSeeds.size,
        skippedInvalidNames: Array.from(skippedNames),
        partnersInserted: partnerResult?.upsertedCount || 0,
        partnersMatched: partnerResult?.matchedCount || 0,
        productsInserted: productResult?.upsertedCount || 0,
        productsMatched: productResult?.matchedCount || 0,
        assignmentPolicyInitialized: {
          eligibilityEnabled: eligibilityPolicyResult.modifiedCount,
          seoCatalogDisabled: seoPolicyResult.modifiedCount,
          bankProductCatalogDisabled: bankProductPolicyResult.modifiedCount,
          bankerCatalogDisabled: bankerPolicyResult.modifiedCount,
          manualProductsEnabled: manualPolicyResult.modifiedCount,
        },
        provenanceBackfilled:
          eligibilityProvenanceResult.modifiedCount +
          seoProvenanceResult.modifiedCount +
          bankProductProvenanceResult.modifiedCount +
          bankerProvenanceResult.modifiedCount,
      },
      null,
      2,
    ),
  );
}

migratePartners()
  .catch((error) => {
    console.error("Partner migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
