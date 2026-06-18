import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { SeoMetadata } from "../modals/seoMetadata.model";

type SeedSeoMetadata = {
  pathname: string;
  title: string;
  description: string;
  keywords?: string[];
};

const records: SeedSeoMetadata[] = [
  {
    pathname: "/",
    title: "Fintaraa | Loans, Cards, Insurance & Financial Services",
    description:
      "Compare loans, credit cards, insurance, CIBIL support, registrations, and assisted financial services with Fintaraa.",
    keywords: ["Fintaraa", "loans", "credit cards", "insurance", "CIBIL"],
  },
  {
    pathname: "/about-us",
    title: "About Fintaraa",
    description:
      "Learn about Fintaraa, our vision, and how we help customers compare financial products.",
    keywords: ["about Fintaraa", "financial marketplace", "assisted finance"],
  },
  {
    pathname: "/products",
    title: "Products | Fintaraa",
    description:
      "Explore Fintaraa loans, credit cards, insurance plans, and additional financial services with search and assisted applications.",
    keywords: ["financial products", "loan products", "credit cards", "insurance"],
  },
  {
    pathname: "/blog",
    title: "Financial Insights and Blogs",
    description:
      "Read Fintaraa blogs on loans, credit score, credit cards, insurance, eligibility, documents, EMIs, and responsible financial planning.",
    keywords: ["financial blogs", "loan guides", "credit score", "insurance guides"],
  },
  {
    pathname: "/contact-us",
    title: "Contact Us | Fintaraa",
    description:
      "Contact Fintaraa for loan, credit card, insurance, document verification, partner follow-up, support, business, and grievance-related assistance.",
    keywords: ["contact Fintaraa", "loan support", "financial support"],
  },
  {
    pathname: "/become-dsa",
    title: "Become a DSA Partner | Fintaraa",
    description:
      "Join Fintaraa as a DSA partner and grow with assisted loan, card, and financial product distribution.",
    keywords: ["DSA partner", "loan DSA", "Fintaraa partner"],
  },
  {
    pathname: "/franchise",
    title: "Franchise Opportunities | Fintaraa",
    description:
      "Start a Fintaraa franchise and offer assisted financial product discovery in your local market.",
    keywords: ["Fintaraa franchise", "finance franchise", "business opportunity"],
  },
  {
    pathname: "/partners",
    title: "Partners | Fintaraa",
    description:
      "Explore Fintaraa partner banks, NBFCs, insurers, and financial product providers.",
    keywords: ["Fintaraa partners", "bank partners", "NBFC partners"],
  },
  {
    pathname: "/partners-by-product",
    title: "Partners by Product | Fintaraa",
    description:
      "Find Fintaraa partners by loans, credit cards, insurance, and other financial product categories.",
    keywords: ["partners by product", "loan partners", "insurance partners"],
  },
  {
    pathname: "/offers",
    title: "Offers | Fintaraa",
    description:
      "Discover financial product offers across loans, cards, insurance, and partner services on Fintaraa.",
    keywords: ["loan offers", "credit card offers", "financial offers"],
  },
  {
    pathname: "/cibil-score",
    title: "CIBIL Score | Fintaraa",
    description:
      "Check and understand your CIBIL score with Fintaraa guidance for better financial readiness.",
    keywords: ["CIBIL score", "credit score", "credit report"],
  },
  {
    pathname: "/cibil-score/report",
    title: "CIBIL Report | Fintaraa",
    description:
      "Review your CIBIL report details and understand the factors affecting your credit profile.",
    keywords: ["CIBIL report", "credit report", "credit health"],
  },
  {
    pathname: "/credit-cards",
    title: "Credit Cards | Fintaraa",
    description:
      "Compare credit card options by benefits, rewards, eligibility, and everyday spending needs.",
    keywords: ["credit cards", "best credit card", "card eligibility"],
  },
  {
    pathname: "/application-status",
    title: "Application Status | Fintaraa",
    description:
      "Track your Fintaraa application status for loans, cards, insurance, and assisted financial services.",
    keywords: ["application status", "loan status", "Fintaraa application"],
  },
  {
    pathname: "/support",
    title: "Support | Fintaraa",
    description:
      "Get Fintaraa support for product applications, documents, callbacks, and service queries.",
    keywords: ["Fintaraa support", "customer support", "application help"],
  },
  {
    pathname: "/careers",
    title: "Careers | Fintaraa",
    description:
      "Explore career opportunities at Fintaraa and help build assisted financial journeys for customers.",
    keywords: ["Fintaraa careers", "finance jobs", "career opportunities"],
  },
  {
    pathname: "/login",
    title: "Login | Fintaraa",
    description:
      "Sign in to your Fintaraa account to manage applications, profile, and financial service journeys.",
    keywords: ["Fintaraa login", "account login", "customer login"],
  },
  {
    pathname: "/account/profile",
    title: "Profile & Settings | Fintaraa",
    description:
      "Manage your Fintaraa profile, account preferences, and saved application information.",
    keywords: ["Fintaraa profile", "account settings", "profile management"],
  },
  {
    pathname: "/gst-registration",
    title: "GST Registration | Fintaraa",
    description:
      "Get assistance for GST registration, documents, compliance basics, and business onboarding.",
    keywords: ["GST registration", "GST documents", "business registration"],
  },
  {
    pathname: "/itr-filing",
    title: "ITR Filing | Fintaraa",
    description:
      "Get guided support for ITR filing, documents, income details, and tax return preparation.",
    keywords: ["ITR filing", "income tax return", "tax filing"],
  },
  {
    pathname: "/company-registration",
    title: "Company Registration | Fintaraa",
    description:
      "Start company registration with guided document and compliance support from Fintaraa.",
    keywords: ["company registration", "business setup", "startup registration"],
  },
  {
    pathname: "/refer-and-earn",
    title: "Refer and Earn | Fintaraa",
    description:
      "Refer friends and partners to Fintaraa and earn rewards through eligible financial journeys.",
    keywords: ["refer and earn", "Fintaraa referral", "referral rewards"],
  },
  {
    pathname: "/loan-disclosure",
    title: "Loan Disclosure | Fintaraa",
    description:
      "Read Fintaraa loan disclosure information, assisted journey terms, and responsible borrowing guidance.",
    keywords: ["loan disclosure", "loan terms", "responsible borrowing"],
  },
  {
    pathname: "/privacy-policy",
    title: "Privacy Policy | Fintaraa",
    description:
      "Understand how Fintaraa collects, uses, stores, and protects customer information.",
    keywords: ["privacy policy", "data protection", "Fintaraa privacy"],
  },
  {
    pathname: "/terms-and-conditions",
    title: "Terms and Conditions | Fintaraa",
    description:
      "Read the terms and conditions for using Fintaraa website, services, and assisted journeys.",
    keywords: ["terms and conditions", "Fintaraa terms", "service terms"],
  },
  {
    pathname: "/grievance",
    title: "Grievance Redressal | Fintaraa",
    description:
      "Raise or understand grievance redressal support for Fintaraa services and customer concerns.",
    keywords: ["grievance", "complaint support", "redressal"],
  },
];

const seed = async () => {
  try {
    await connectDB();
    for (const record of records) {
      await SeoMetadata.findOneAndUpdate(
        { pathname: record.pathname, sectionKey: "seo_metadata" },
        {
          ...record,
          slug: `seo-${record.pathname
            .replace(/^\/$/, "home")
            .replace(/[^a-zA-Z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase()}`,
          type: "article",
          sectionKey: "seo_metadata",
          canonicalPath: record.pathname,
          openGraphTitle: record.title,
          openGraphDescription: record.description,
          twitterTitle: record.title,
          twitterDescription: record.description,
          robotsIndex: true,
          robotsFollow: true,
          isActive: true,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    console.log(`Seeded ${records.length} SEO metadata records.`);
  } catch (error) {
    console.error("SEO metadata seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
