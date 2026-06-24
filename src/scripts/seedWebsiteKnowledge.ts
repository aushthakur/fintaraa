import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { Knowledge } from "../modals/knowledge.model";

const now = new Date();
const dayMs = 86400000;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const blogCategories = [
  "Personal Loan",
  "Home Loan",
  "Business Loan",
  "Credit Cards",
  "CIBIL Score",
  "Health Insurance",
  "Term Insurance",
  "Car Loan",
  "Gold Loan",
  "Financial Planning",
];

const cities = [
  "Delhi",
  "Mumbai",
  "Bengaluru",
  "Pune",
  "Hyderabad",
  "Chennai",
  "Jaipur",
  "Ahmedabad",
  "Kolkata",
  "Gurugram",
];

const names = [
  "Aarav Mehta",
  "Ananya Sharma",
  "Rohan Kapoor",
  "Ishita Verma",
  "Kabir Arora",
  "Priya Nair",
  "Aditya Rao",
  "Neha Malhotra",
  "Vikram Singh",
  "Meera Iyer",
  "Arjun Bansal",
  "Kavya Menon",
  "Rahul Sethi",
  "Sanya Gupta",
  "Devansh Jain",
  "Tanya Khanna",
  "Nikhil Shah",
  "Ritika Sood",
  "Siddharth Bose",
  "Aisha Khan",
];

const blogTitles = [
  "How to Choose a Personal Loan Without Overpaying",
  "CIBIL Score Improvement Plan for the Next 90 Days",
  "Credit Card Rewards You Should Actually Track",
  "Home Loan Eligibility Documents Checklist",
  "Business Loan Readiness for First-Time Founders",
  "Term Insurance Cover Planning for Young Families",
  "Health Insurance Add-Ons Worth Comparing",
  "Car Loan EMI Planning Before Visiting a Dealer",
  "Gold Loan Checklist Before Pledging Jewellery",
  "How to Compare Processing Fees Across Lenders",
  "What Makes an Instant Loan Offer Reliable",
  "Balance Transfer Decisions for Existing Loans",
  "Loan Against Property Eligibility Explained",
  "Working Capital Loan Planning for Small Businesses",
  "Credit Utilisation Rules for Better Bureau Health",
  "Documents Salaried Applicants Should Keep Ready",
  "Documents Self-Employed Applicants Should Keep Ready",
  "How to Read an Insurance Policy Brochure",
  "Credit Card Annual Fee Waiver Conditions Explained",
  "Prepayment and Foreclosure Charges Checklist",
  "How to Compare Loan Tenure vs Total Interest",
  "Why Soft Eligibility Checks Matter",
  "Smart Ways to Lower Monthly EMI Stress",
  "What First-Time Borrowers Should Know",
  "How to Avoid Common Loan Application Delays",
  "Premium Credit Cards vs Cashback Cards",
  "Travel Credit Card Benefits to Validate",
  "Family Floater Health Insurance Checks",
  "Top-Up Loan Planning for Existing Borrowers",
  "Education Loan Planning for Indian Families",
  "Two Wheeler Loan Cost Breakdown",
  "Personal Accident Cover Buying Checklist",
  "Home Insurance Basics for New Buyers",
  "Credit Report Errors and How to Fix Them",
  "Debt-to-Income Ratio Explained Simply",
  "What Lenders Check Beyond Credit Score",
  "Bank Statement Hygiene Before Loan Application",
  "Loan Approval Timeline: What Really Happens",
  "How to Pick the Right EMI Date",
  "Why Insurance Claim Ratio Needs Context",
  "How to Compare Credit Card Joining Benefits",
  "Emergency Fund Planning Before Borrowing",
  "Secured vs Unsecured Loans Explained",
  "How to Prepare for Video KYC",
  "Insurance Exclusions You Should Read First",
  "Credit Card Limit Increase Dos and Donts",
  "Business Loan Cash Flow Checklist",
  "Home Loan Balance Transfer Readiness",
  "How to Use Loan Calculators Correctly",
  "Responsible Borrowing Checklist for 2026",
];

const pressThemes = [
  "assisted loan discovery",
  "credit card comparison",
  "insurance education",
  "CIBIL awareness",
  "partner bank experience",
  "digital documentation",
  "regional financial access",
  "customer support quality",
  "eligibility-led journeys",
  "financial literacy",
];

const blogHtml = (title: string, category: string, index: number) => `
  <h2>${title}</h2>
  <p>${category} decisions are easier when customers compare eligibility, fees, documentation, timelines, and long-term affordability together. Fintaraa keeps the journey structured so users can move from discovery to action with clarity.</p>
  <h3>What to check first</h3>
  <p>Start with your income stability, credit profile, existing obligations, and the product terms that affect total cost. Do not rely only on a headline rate or a promotional reward.</p>
  <ul>
    <li>Compare total payable amount, fees, and renewal charges.</li>
    <li>Keep PAN, address proof, income proof, and bank statements ready.</li>
    <li>Review eligibility before submitting multiple applications.</li>
    <li>Match product benefits with your actual usage pattern.</li>
  </ul>
  <h3>Fintaraa checklist</h3>
  <p>Use Fintaraa to compare options, understand the next documents required, and continue through a guided application journey. The aim is to reduce avoidable back-and-forth and help users make informed decisions.</p>
  <blockquote>Premium financial decisions are not about choosing the fastest offer; they are about choosing the offer you can manage comfortably.</blockquote>
  <p>Review this checklist again before final submission. If two products look similar, compare support timelines, flexibility, and future servicing quality.</p>
  <p><strong>Editorial reference:</strong> FTR-KH-${String(index + 1).padStart(3, "0")}</p>
`;

const pressHtml = (title: string, theme: string, index: number) => `
  <h2>${title}</h2>
  <p>Fintaraa continues to strengthen ${theme} through structured digital journeys, assisted customer support, and product education across loans, credit cards, insurance, and credit health.</p>
  <h3>Announcement highlights</h3>
  <ul>
    <li>Clearer product discovery flows for customers across major Indian cities.</li>
    <li>Improved partner-led guidance around eligibility, documents, and next actions.</li>
    <li>Better educational content for users comparing financial products online.</li>
  </ul>
  <p>The update reflects Fintaraa's focus on transparent, guided, and responsible financial marketplace experiences.</p>
  <h3>About Fintaraa</h3>
  <p>Fintaraa helps users discover and compare financial services with assisted support across loans, credit cards, insurance, CIBIL support, and business services.</p>
  <p><strong>Media reference:</strong> FTR-PR-${String(index + 1).padStart(3, "0")}</p>
`;

const testimonialHtml = (name: string, city: string, category: string, quote: string) => `
  <h2>${name}'s Fintaraa experience</h2>
  <p>${quote}</p>
  <p>Based in ${city}, ${name.split(" ")[0]} used Fintaraa to understand ${category.toLowerCase()} options, compare key terms, and prepare the next set of details with better confidence.</p>
  <h3>What worked well</h3>
  <ul>
    <li>Clear explanation of eligibility and documents.</li>
    <li>Simple comparison between available options.</li>
    <li>Guided support before moving ahead with application steps.</li>
  </ul>
`;

const buildBlogs = () =>
  blogTitles.map((title, index) => {
    const category = blogCategories[index % blogCategories.length];
    const slug = slugify(`fintaraa-guide-${index + 1}-${title}`);
    return {
      title,
      slug,
      type: "blog",
      sectionKey: "recent_blogs",
      category,
      summary: `A premium guide to ${category.toLowerCase()} decisions, covering eligibility, documents, fees, timelines, and practical Fintaraa checks.`,
      excerpt: `Compare ${category.toLowerCase()} options with a clearer view of eligibility, documents, fees, and long-term affordability.`,
      content: blogHtml(title, category, index),
      coverImageUrl: `/assets/blogs/blog${(index % 5) + 1}.png`,
      authorName: "Fintaraa Editorial",
      authorRole: "Financial Research Desk",
      authorAvatarUrl: "/assets/images/user1.png",
      readTime: `${5 + (index % 6)} min read`,
      accent: ["#005ca8", "#08a045", "#6366f1", "#f97316", "#14b8a6"][index % 5],
      tags: [category, "Guide", "Fintaraa", "Financial Planning"],
      metaTagTitle: `${title} | Fintaraa`,
      metaTagDescription: `Read Fintaraa's premium guide on ${category.toLowerCase()} with eligibility, documentation, and planning checks.`,
      metaTagKeywords: [category, "Fintaraa", "loan guide", "credit guide"],
      buttonLabel: "Read Guide",
      leadSource: "website_knowledge_seed",
      isActive: true,
      publishedAt: new Date(now.getTime() - (index + 1) * dayMs),
      publishedOn: new Date(now.getTime() - (index + 1) * dayMs),
    };
  });

const buildPressReleases = () =>
  Array.from({ length: 50 }).map((_, index) => {
    const theme = pressThemes[index % pressThemes.length];
    const city = cities[index % cities.length];
    const title = `Fintaraa strengthens ${theme} for customers in ${city}`;
    const slug = slugify(`press-release-${index + 1}-${theme}-${city}`);
    return {
      title,
      slug,
      type: "press_release",
      sectionKey: "media_press_release",
      category:
        [
          "Company News",
          "Product Update",
          "Partnership",
          "Market Insight",
          "Customer Experience",
        ][index % 5],
      summary: `Fintaraa announces a premium update around ${theme}, helping users compare financial products with clearer guidance and assisted support.`,
      excerpt: `A Fintaraa media update on ${theme}, customer education, and assisted financial product discovery.`,
      content: pressHtml(title, theme, index),
      coverImageUrl: `/assets/images/media${(index % 4) + 1}.png`,
      linkUrl: `/press-release/${slug}`,
      authorName: "Fintaraa Communications",
      authorRole: "Media Desk",
      readTime: `${3 + (index % 3)} min read`,
      tags: ["Press Release", "Fintaraa", theme, city],
      metaTagTitle: `${title} | Fintaraa Press Release`,
      metaTagDescription: `Official Fintaraa press release about ${theme} and assisted financial journeys.`,
      metaTagKeywords: ["Fintaraa press release", theme, city],
      buttonLabel: "Read Release",
      leadSource: "website_knowledge_seed",
      isActive: true,
      publishedAt: new Date(now.getTime() - (index + 2) * dayMs),
      publishedOn: new Date(now.getTime() - (index + 2) * dayMs),
    };
  });

const buildClientTestimonials = () =>
  Array.from({ length: 50 }).map((_, index) => {
    const name = names[index % names.length];
    const city = cities[index % cities.length];
    const category = blogCategories[index % blogCategories.length];
    const quote = `Fintaraa helped me compare ${category.toLowerCase()} options with clear eligibility guidance, document support, and a smoother next-step experience.`;
    const slug = slugify(`client-testimonial-${index + 1}-${name}-${city}`);
    return {
      title: `${name} on Fintaraa ${category} support`,
      slug,
      type: "testimonial",
      sectionKey: "client_testimonials",
      category,
      summary: quote,
      excerpt: quote,
      content: testimonialHtml(name, city, category, quote),
      authorName: name,
      authorRole: "Fintaraa Customer",
      authorAvatarUrl: `/assets/images/testimonials/client-${(index % 4) + 1}.jpg`,
      location: city,
      rating: 5,
      tags: [category, city, "Customer Story"],
      metaTagTitle: `${name} Fintaraa Review | ${category}`,
      metaTagDescription: `${name}'s customer story with Fintaraa for ${category.toLowerCase()} assistance in ${city}.`,
      buttonLabel: "Read Story",
      leadSource: "website_knowledge_seed",
      isActive: true,
      publishedAt: new Date(now.getTime() - (index + 3) * dayMs),
      publishedOn: new Date(now.getTime() - (index + 3) * dayMs),
    };
  });

const buildVideoTestimonials = () =>
  Array.from({ length: 50 }).map((_, index) => {
    const name = names[(index + 5) % names.length];
    const city = cities[(index + 2) % cities.length];
    const category = blogCategories[(index + 3) % blogCategories.length];
    const quote = `${name.split(" ")[0]} explains how Fintaraa made ${category.toLowerCase()} comparison easier with assisted guidance and transparent next steps.`;
    const slug = slugify(`video-testimonial-${index + 1}-${name}-${category}`);
    return {
      title: `${name} video testimonial`,
      slug,
      type: "video",
      sectionKey: "video_testimonials",
      category,
      summary: quote,
      excerpt: quote,
      content: testimonialHtml(name, city, category, quote),
      authorName: name,
      authorRole: "Fintaraa Customer",
      location: city,
      rating: 5,
      coverImageUrl: `/assets/images/testimonials/video-${(index % 3) + 1}.jpg`,
      videoUrl:
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      tags: [category, city, "Video Testimonial"],
      metaTagTitle: `${name} Video Testimonial | Fintaraa`,
      metaTagDescription: `Watch ${name}'s Fintaraa video testimonial about ${category.toLowerCase()} assistance in ${city}.`,
      buttonLabel: "Watch Story",
      leadSource: "website_knowledge_seed",
      isActive: true,
      publishedAt: new Date(now.getTime() - (index + 4) * dayMs),
      publishedOn: new Date(now.getTime() - (index + 4) * dayMs),
    };
  });

const items = [
  ...buildBlogs(),
  ...buildPressReleases(),
  ...buildClientTestimonials(),
  ...buildVideoTestimonials(),
];

const seed = async () => {
  try {
    await connectDB();
    const operations = items.map((item) => ({
        updateOne: {
          filter: { slug: item.slug },
          update: {
            $set: {
              ...item,
              editedByName: "Fintaraa Seeder",
              editedByRole: "System",
              editedAt: new Date(),
              editedOn: new Date(),
              editedBy: "Fintaraa Seeder",
            },
            $setOnInsert: {
              createdByName: "Fintaraa Seeder",
              createdByRole: "System",
              createdBy: "Fintaraa Seeder",
              createdOn: new Date(),
            },
          },
          upsert: true,
        },
      })) as any[];

    await Knowledge.bulkWrite(operations, { ordered: false });

    const counts = await Knowledge.aggregate([
      {
        $match: {
          sectionKey: {
            $in: [
              "recent_blogs",
              "media_press_release",
              "client_testimonials",
              "video_testimonials",
            ],
          },
          isActive: true,
        },
      },
      { $group: { _id: "$sectionKey", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    console.log(
      `Seeded/updated ${items.length} website knowledge records.`,
      counts,
    );
  } catch (error) {
    console.error("Website knowledge seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
