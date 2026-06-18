import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { LoanSeoPage, LoanSeoPageStatus } from "../modals/loanSeoPage.model";
import {
  InsuranceSeoPage,
  InsuranceSeoPageStatus,
} from "../modals/insuranceSeoPage.model";
import { Area, City, Country, Pincode, State } from "../modals/statecity.model";

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
        pincodes: [{ code: "110001", areas: ["Connaught Place", "Janpath"] }],
      },
    ],
  },
  {
    country: { name: "India", code: "IN" },
    state: { name: "Karnataka", code: "KA" },
    cities: [
      {
        name: "Bengaluru",
        pincodes: [{ code: "560001", areas: ["MG Road", "Ashok Nagar"] }],
      },
    ],
  },
];

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const locationLabel = (location: Record<string, string>) =>
  [location.area, location.pincode, location.city, location.state]
    .filter(Boolean)
    .join(", ");

const canonicalPath = (productSlug: string, location: Record<string, string>) =>
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

const buildTabs = (product: string, scoped: string) => [
  {
    key: "overview",
    label: "Overview",
    eyebrow: "SEO guide",
    title: `${scoped} overview`,
    description: `Understand ${product} options, eligibility, documents, and assisted application support in this location.`,
    bullets: [
      "Compare product requirements before applying.",
      "Prepare KYC, address, income, or policy documents in advance.",
      "Continue with a guided Fintaraa application journey.",
    ],
    filterKeys: ["overview", "location"],
    sortOrder: 1,
    isActive: true,
  },
  {
    key: "documents",
    label: "Documents",
    eyebrow: "Checklist",
    title: `Documents for ${scoped}`,
    description:
      "Exact requirements can vary by partner and applicant profile.",
    bullets: [
      "Identity and address proof.",
      "PAN and registered mobile number.",
      "Income, asset, health, or existing policy details where applicable.",
    ],
    filterKeys: ["documents", "kyc"],
    sortOrder: 2,
    isActive: true,
  },
];

const buildFormFields = () => [
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
    key: "pincode",
    label: "Pincode",
    type: "text",
    placeholder: "Service pincode",
    required: true,
    filterKey: "pincode",
    sortOrder: 3,
    isActive: true,
  },
];

const upsertLocations = async () => {
  const seededAreas: Array<Record<string, string>> = [];
  let canWritePincodeAreaCollections = true;

  for (const block of locations) {
    const country = await Country.findOneAndUpdate(
      { name: block.country.name },
      block.country,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const state = await State.findOneAndUpdate(
      { name: block.state.name },
      { ...block.state, countryId: country._id },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    for (const cityInput of block.cities) {
      const city = await City.findOneAndUpdate(
        { name: cityInput.name },
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

const upsertSeoPages = async (seededAreas: Array<Record<string, string>>) => {
  const selectedLocations = seededAreas.slice(0, 6);
  const loanProducts = ["Personal Loan", "Home Loan", "Business Loan"];
  const insuranceProducts = ["Health Insurance", "Vehicle Insurance"];
  let skippedByCollectionLimit = false;

  for (const [index, location] of selectedLocations.entries()) {
    const loanType = loanProducts[index % loanProducts.length];
    const loanTypeSlug = slugify(loanType);
    const scopedLoan = `${loanType} in ${locationLabel(location)}`;

    await LoanSeoPage.findOneAndUpdate(
      { loanTypeSlug, location },
      {
        loanType,
        loanTypeSlug,
        title: scopedLoan,
        subtitle:
          "Location-specific SEO page for assisted loan eligibility, documents, and application support.",
        heroTitle: `${scopedLoan} made easier`,
        heroDescription:
          "Compare requirements and continue with Fintaraa guided support.",
        seoTitle: `${scopedLoan} | Fintaraa`,
        seoDescription: `Apply for ${scopedLoan} with Fintaraa. Check eligibility, documents, EMI comfort, and partner offers.`,
        canonicalPath: canonicalPath(loanTypeSlug, location),
        location,
        badges: ["SEO ready", "Location page", "Assisted journey"],
        filterKeys: ["overview", "eligibility", "documents", "location"],
        tabs: buildTabs(loanType, scopedLoan),
        formFields: buildFormFields(),
        status:
          index % 4 === 0 ? LoanSeoPageStatus.DRAFT : LoanSeoPageStatus.ACTIVE,
        isIndexable: index % 4 !== 0,
        isFeatured: index === 0,
        priority: 10 + index,
        publishedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).catch((error) => {
      if (error?.code === 8000) {
        skippedByCollectionLimit = true;
        return null;
      }
      throw error;
    });

    if (skippedByCollectionLimit) break;

    const insuranceType = insuranceProducts[index % insuranceProducts.length];
    const insuranceTypeSlug = slugify(insuranceType);
    const scopedInsurance = `${insuranceType} in ${locationLabel(location)}`;

    await InsuranceSeoPage.findOneAndUpdate(
      { insuranceTypeSlug, location },
      {
        insuranceType,
        insuranceTypeSlug,
        title: scopedInsurance,
        subtitle:
          "Location-specific SEO page for insurance coverage, documents, and enquiry support.",
        heroTitle: `${scopedInsurance} plans`,
        heroDescription:
          "Compare coverage basics and continue with Fintaraa guided support.",
        seoTitle: `${scopedInsurance} | Fintaraa`,
        seoDescription: `Compare ${scopedInsurance} plans with Fintaraa. Review premiums, coverage, documents, and partner options.`,
        canonicalPath: canonicalPath(insuranceTypeSlug, location),
        location,
        badges: ["SEO ready", "Location page", "Coverage guide"],
        filterKeys: ["coverage", "documents", "claims", "location"],
        tabs: buildTabs(insuranceType, scopedInsurance),
        formFields: buildFormFields(),
        status:
          index % 5 === 0
            ? InsuranceSeoPageStatus.DRAFT
            : InsuranceSeoPageStatus.ACTIVE,
        isIndexable: index % 5 !== 0,
        isFeatured: index === 1,
        priority: 20 + index,
        publishedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).catch((error) => {
      if (error?.code === 8000) {
        skippedByCollectionLimit = true;
        return null;
      }
      throw error;
    });

    if (skippedByCollectionLimit) break;
  }

  return {
    loanPages: skippedByCollectionLimit ? 0 : selectedLocations.length,
    insurancePages: skippedByCollectionLimit ? 0 : selectedLocations.length,
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
