import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { Knowledge } from "../modals/knowledge.model";

const now = new Date();

const blogHtml = (title: string, topic: string) => `
  <h2>${title}</h2>
  <p>${topic} can feel complicated when users only compare headline rates or one promotional benefit. A better decision starts with understanding eligibility, repayment comfort, documentation, and long-term cost.</p>
  <h3>What to check first</h3>
  <p>Start with your monthly cash flow, credit profile, and the documents required by lenders or partners. Keep PAN, address proof, income proof, and bank statements ready before applying.</p>
  <ul>
    <li>Compare the total payable amount, not only the EMI.</li>
    <li>Review fees, prepayment terms, and support timelines.</li>
    <li>Use guided assistance when multiple products look similar.</li>
  </ul>
  <h3>How Fintaraa helps</h3>
  <p>Fintaraa helps customers understand options, prepare details, and continue with a structured assisted journey. The goal is to make financial decisions clearer and easier to track.</p>
`;

const items = [
  ...[
    ["Amit Verma", "Gurugram", "Personal Loan", "Fintaraa helped me compare multiple offers and complete the document journey without confusion.", "/assets/images/user1.png"],
    ["Neha Sharma", "Delhi", "Home Loan", "The callback team explained eligibility and next steps clearly. My application moved faster than expected.", "/assets/images/user2.png"],
    ["Rohit Mehta", "Noida", "Credit Card", "I found a card that matched my monthly spends and got timely support during application.", "/assets/images/user3.png"],
    ["Pooja Singh", "Mumbai", "Business Loan", "Their team helped me understand lender requirements before applying, which saved a lot of back-and-forth.", "/assets/images/user1.png"],
    ["Karan Malhotra", "Bengaluru", "Insurance", "The process was simple, and the team helped me compare coverage instead of only premium.", "/assets/images/user2.png"],
  ].map(([name, location, category, summary, avatar], index) => ({
    title: `${name} on Fintaraa support`,
    slug: `client-testimonial-${index + 1}`,
    type: "testimonial",
    sectionKey: "client_testimonials",
    category,
    summary,
    content: summary,
    authorName: name,
    authorRole: "Fintaraa Customer",
    authorAvatarUrl: avatar,
    location,
    rating: 5,
    isActive: true,
    publishedAt: new Date(now.getTime() - index * 86400000),
  })),
  ...[
    ["How to Choose a Personal Loan Without Overpaying", "Compare rates, tenure, fees, and repayment comfort before accepting a personal loan offer.", "Loans", "#0ea5e9"],
    ["Practical Ways to Improve Your CIBIL Score", "Build better credit health with consistent repayments, lower utilisation, and clean report behaviour.", "Credit Score", "#22c55e"],
    ["Credit Card Selection Guide for Everyday Spends", "Match card benefits to your real spending pattern instead of chasing headline rewards.", "Credit Cards", "#6366f1"],
    ["Home Loan Eligibility and Documents Checklist", "Prepare income, property, banking, and KYC documents early to reduce back-and-forth during home loan processing.", "Loans", "#14b8a6", "home-loan-eligibility-documents"],
    ["Term Insurance Checks Before You Buy", "Understand cover amount, claim support, exclusions, riders, and long-term premium commitment.", "Insurance", "#f97316"],
  ].map(([title, summary, category, accent, slug], index) => ({
    title,
    slug:
      slug ||
      String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    type: "blog",
    sectionKey: "recent_blogs",
    category,
    summary,
    excerpt: summary,
    content: blogHtml(String(title), String(category)),
    coverImageUrl: `/assets/blogs/blog${(index % 5) + 1}.png`,
    authorName: "Fintaraa Editorial",
    authorRole: "Financial Research Desk",
    authorAvatarUrl: "/assets/images/user1.png",
    readTime: `${5 + index} min read`,
    accent,
    tags: [String(category), "Guide", "Fintaraa"],
    isActive: true,
    publishedAt: new Date(now.getTime() - (index + 2) * 86400000),
  })),
  ...[
    ["Fintaraa expands assisted loan discovery journeys", "Coverage on Fintaraa improving assisted credit discovery for customers across India.", "Company News", "/assets/images/media1.png"],
    ["Digital-first credit matching improves customer choice", "A look at how guided flows help users compare products before continuing applications.", "Media", "/assets/images/media2.png"],
    ["Partner-led lending marketplace gains adoption", "Fintaraa partner workflows continue to simplify product discovery and support.", "Partnership", "/assets/images/media3.png"],
    ["Fintaraa launches faster credit score assisted journeys", "Users can better understand credit health and next actions through guided experiences.", "Product Update", "/assets/images/media4.png"],
    ["Financial guidance demand rises in tier-two cities", "Customers are seeking clearer assistance across loans, cards, and insurance products.", "Insights", "/assets/images/media1.png"],
  ].map(([title, summary, category, image], index) => ({
    title,
    slug: `press-release-${index + 1}`,
    type: "press_release",
    sectionKey: "media_press_release",
    category,
    summary,
    content: summary,
    coverImageUrl: image,
    linkUrl: "/blog",
    isActive: true,
    publishedAt: new Date(now.getTime() - (index + 5) * 86400000),
  })),
  ...[
    ["Deepika Kumari", "Delhi", "Home Loan", "Fintaraa supported me when I needed clear home loan guidance.", "/assets/images/media1.png"],
    ["Saurabh Jain", "Jaipur", "Personal Loan", "The team explained offers and documents in a simple way.", "/assets/images/media2.png"],
    ["Anjali Mehta", "Pune", "Credit Card", "I understood which card fit my spends before applying.", "/assets/images/media3.png"],
    ["Vikram Rao", "Hyderabad", "Business Loan", "The assisted journey helped me prepare before lender review.", "/assets/images/media4.png"],
    ["Meera Nair", "Kochi", "Insurance", "I could compare benefits and exclusions with better clarity.", "/assets/images/media1.png"],
  ].map(([name, location, category, quote, thumbnail], index) => ({
    title: `${name} video testimonial`,
    slug: `video-testimonial-${index + 1}`,
    type: "video",
    sectionKey: "video_testimonials",
    category,
    summary: quote,
    content: quote,
    authorName: name,
    authorRole: "Fintaraa Customer",
    location,
    rating: 5,
    coverImageUrl: thumbnail,
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    isActive: true,
    publishedAt: new Date(now.getTime() - (index + 8) * 86400000),
  })),
];

const seed = async () => {
  try {
    await connectDB();
    for (const item of items) {
      await Knowledge.findOneAndUpdate(
        { slug: item.slug },
        item,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    console.log(`Seeded ${items.length} website knowledge records.`);
  } catch (error) {
    console.error("Website knowledge seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
