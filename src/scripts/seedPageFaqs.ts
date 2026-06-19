import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { PageFaq, PageFaqItem } from "../modals/pageFaq.model";

type SeedPageFaq = {
  pathname: string;
  pathAliases?: string[];
  title?: string;
  subtitle?: string;
  items: PageFaqItem[];
  priorityOrder?: number;
};

const normalizePathname = (value: string) => {
  let path = value.trim() || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path;
};

const makeSlug = (pathname: string) =>
  `page-faq-${pathname === "/" ? "home" : pathname.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;

const makeStoragePathname = (pathname: string) => `faq:${pathname}`;

const commonTrackingFaqs = [
  {
    question: "Can I track my submitted request online?",
    answer:
      "Yes. Use your Query ID or registered mobile number to view the latest request status, assigned executive, timeline, and remarks.",
  },
  {
    question: "Will Fintaraa contact me after submission?",
    answer:
      "Yes. Our team reviews the submitted details and contacts you for documents, eligibility checks, or next steps.",
  },
];

const records: SeedPageFaq[] = [
  {
    pathname: "/contact-us",
    subtitle: "Answers about contacting Fintaraa and getting support.",
    items: [
      {
        question: "How quickly will the Fintaraa team respond?",
        answer:
          "Most contact requests are reviewed within one working day. Response time can vary based on request type and document readiness.",
      },
      {
        question: "Can I get help choosing the right loan or card?",
        answer:
          "Yes. Share your requirement and our team can guide you through loan, credit card, insurance, or service options available through Fintaraa.",
      },
      {
        question: "What details should I share for faster assistance?",
        answer:
          "Share your name, mobile number, product requirement, city, and a short description of the help you need.",
      },
      ...commonTrackingFaqs,
    ],
  },
  {
    pathname: "/careers",
    subtitle: "Answers about jobs, applications, and hiring at Fintaraa.",
    items: [
      {
        question: "How do I apply for an open role?",
        answer:
          "Open the Careers page, choose a suitable job posting, fill in your details, and upload your resume through the application form.",
      },
      {
        question: "Can I apply for more than one role?",
        answer:
          "Yes. You can apply for multiple relevant roles if your experience and skills match the listed requirements.",
      },
      {
        question: "What happens after I submit my application?",
        answer:
          "The hiring team reviews your profile and may contact you for screening, interview scheduling, or additional details.",
      },
      {
        question: "Do I need finance industry experience?",
        answer:
          "Some roles require financial-services experience, while entry-level sales and support roles may consider strong communication and learning ability.",
      },
    ],
  },
  {
    pathname: "/credit-cards",
    subtitle: "Answers about comparing and applying for credit cards.",
    items: [
      {
        question: "How does Fintaraa show credit card eligibility?",
        answer:
          "Eligibility is estimated using available profile details such as income, employment, credit score, and bank criteria where available.",
      },
      {
        question: "Can I compare multiple credit cards?",
        answer:
          "Yes. Select cards from the listing and use Compare Now to view fees, benefits, eligibility, network, and rewards side by side.",
      },
      {
        question: "Does applying through Fintaraa guarantee approval?",
        answer:
          "No. Final approval is always subject to the issuing bank's policy, verification, credit assessment, and documentation.",
      },
      {
        question: "Are credit card fees shown before applying?",
        answer:
          "Yes. Joining fees, annual fees, rewards, and major benefits are shown wherever bank product data is available.",
      },
    ],
  },
  {
    pathname: "/blog",
    subtitle: "Answers about Fintaraa guides, articles, and financial education.",
    items: [
      {
        question: "What topics are covered in Fintaraa blogs?",
        answer:
          "Fintaraa blogs cover loans, credit cards, CIBIL score, insurance, documentation, eligibility, EMI planning, and service guides.",
      },
      {
        question: "Are blog articles financial advice?",
        answer:
          "Articles are educational and informational. Product decisions should be made after reviewing eligibility, costs, terms, and partner policies.",
      },
      {
        question: "How often are blogs updated?",
        answer:
          "Content is updated as product information, eligibility practices, or financial-service processes change.",
      },
    ],
  },
  {
    pathname: "/blog/[slug]",
    subtitle: "Answers related to Fintaraa blog detail pages.",
    pathAliases: ["/blog/home-loan-eligibility-documents"],
    items: [
      {
        question: "Can I apply directly after reading a guide?",
        answer:
          "Yes. You can visit the relevant product page or contact Fintaraa for assisted application support after reading a guide.",
      },
      {
        question: "Are documents and eligibility rules the same for every bank?",
        answer:
          "No. Requirements can vary by bank, NBFC, product type, income profile, and location.",
      },
      {
        question: "Can Fintaraa help verify which documents are needed?",
        answer:
          "Yes. Our team can help you understand basic document requirements before your application is moved to a partner.",
      },
    ],
  },
  {
    pathname: "/become-dsa",
    subtitle: "Answers about becoming a Fintaraa DSA partner.",
    items: [
      {
        question: "Who can become a Fintaraa DSA partner?",
        answer:
          "Individuals or businesses with local customer reach, sales discipline, and financial-product interest can apply for DSA onboarding.",
      },
      {
        question: "Do I need prior loan sales experience?",
        answer:
          "Prior experience helps, but Fintaraa can also consider applicants with strong customer handling and local market knowledge.",
      },
      {
        question: "How are DSA commissions managed?",
        answer:
          "Commission terms depend on product category, partner rules, and successful disbursal or conversion conditions shared during onboarding.",
      },
      {
        question: "Will I get training and support?",
        answer:
          "Yes. Fintaraa provides process guidance, product information, and operational support for partner workflows.",
      },
    ],
  },
  {
    pathname: "/franchise",
    subtitle: "Answers about Fintaraa franchise opportunities.",
    items: [
      {
        question: "How much investment is required for a Fintaraa franchise?",
        answer:
          "Investment depends on city, operating model, staffing, and commercial terms discussed during franchise onboarding.",
      },
      {
        question: "Can I operate from my own city?",
        answer:
          "Yes. Franchise opportunities are evaluated city-wise based on market potential, coverage, and operating readiness.",
      },
      {
        question: "What support does Fintaraa provide?",
        answer:
          "Fintaraa can support training, product process guidance, partner coordination workflows, and brand-led operating standards.",
      },
      {
        question: "How long does onboarding take?",
        answer:
          "Onboarding duration depends on document completion, commercial discussion, agreement execution, and setup readiness.",
      },
    ],
  },
  {
    pathname: "/cibil-score/report",
    subtitle: "Answers about credit report data and recommendations.",
    items: [
      {
        question: "What does the CIBIL report page show?",
        answer:
          "It shows available credit score data, account summaries, enquiries, repayment signals, utilization, and recommendations where fetched data is available.",
      },
      {
        question: "Can I refresh my credit report?",
        answer:
          "Yes. Logged-in users can refetch available credit data when the integration and required user details are available.",
      },
      {
        question: "Will checking my report reduce my score?",
        answer:
          "A consumer-initiated report check is generally treated differently from a lender hard enquiry and should not reduce your score.",
      },
    ],
  },
  {
    pathname: "/products/[loanType]",
    subtitle: "Answers about loan eligibility, documents, and assisted applications.",
    items: [
      {
        question: "How do I check loan eligibility?",
        answer:
          "Open the relevant loan page, review basic eligibility, and submit an application form so Fintaraa can guide you through the next steps.",
      },
      {
        question: "Which documents are usually required?",
        answer:
          "Common documents include PAN, Aadhaar, income proof, bank statements, address proof, and product-specific documents.",
      },
      {
        question: "Does Fintaraa decide final loan approval?",
        answer:
          "No. Final approval, rate, amount, and tenure are decided by the lender after verification and credit assessment.",
      },
      {
        question: "Can I add a co-applicant?",
        answer:
          "Yes. For eligible loan types, you can add one or more co-applicants and upload their required documents during the application flow.",
      },
    ],
  },
  {
    pathname: "/products/[insuranceType]",
    subtitle: "Answers about insurance cover, documents, and assisted purchase.",
    items: [
      {
        question: "How do I compare insurance plans?",
        answer:
          "Review coverage, exclusions, premium, claim support, and documents on the insurance detail page before moving ahead.",
      },
      {
        question: "Are premiums final on the website?",
        answer:
          "Displayed premiums or examples are indicative unless confirmed by the insurer after underwriting and required checks.",
      },
      {
        question: "What documents are required for insurance?",
        answer:
          "Typical documents include identity proof, address proof, age proof, income details, and product-specific medical or asset documents.",
      },
      {
        question: "Can Fintaraa help with claims guidance?",
        answer:
          "Fintaraa can guide you on claim documentation and insurer process where support is available for the selected product.",
      },
    ],
  },
];

const seed = async () => {
  try {
    await connectDB();
    for (const record of records) {
      const pathname = normalizePathname(record.pathname);
      await PageFaq.findOneAndUpdate(
        { recordType: "page_faq", pagePathname: pathname },
        {
          recordType: "page_faq",
          slug: makeSlug(pathname),
          pathname: makeStoragePathname(pathname),
          pagePathname: pathname,
          pathAliases: (record.pathAliases || []).map(normalizePathname),
          title: record.title || "Frequently Asked Questions",
          subtitle: record.subtitle || "Answers to common questions about this page.",
          items: record.items.map((item, index) => ({
            ...item,
            isActive: item.isActive !== false,
            priorityOrder: item.priorityOrder ?? index + 1,
          })),
          schemaEnabled: true,
          status: "active",
          priorityOrder: record.priorityOrder || 0,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    console.log(`Seeded ${records.length} page FAQ records.`);
  } catch (error) {
    console.error("Page FAQ seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
