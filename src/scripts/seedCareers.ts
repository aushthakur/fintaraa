import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { JobPosting } from "../modals/career.model";

const nextDeadline = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const jobs = [
  {
    title: "Relationship Manager",
    slug: "career-relationship-manager-new-delhi",
    department: "Sales Department",
    location: "New Delhi",
    experience: "1-2 Years",
    employmentType: "Full Time",
    skills: ["Customer handling", "Loan sales", "CRM", "Follow-ups"],
    responsibilities: [
      "Manage borrower relationships from enquiry to documentation.",
      "Coordinate with banking partners for faster application movement.",
      "Maintain transparent communication with customers.",
    ],
    requirements: [
      "1+ year experience in loans, banking, or financial services.",
      "Strong communication and field coordination skills.",
    ],
    salaryRange: "₹3 LPA - ₹5 LPA",
    status: "published",
    openingsCount: 5,
    applicationDeadline: nextDeadline(45),
    summary:
      "Own customer relationships and help applicants complete loan and insurance journeys.",
    priorityOrder: 1,
  },
  {
    title: "Credit Card Sales Executive",
    slug: "career-credit-card-sales-executive-gurugram",
    department: "Credit Cards",
    location: "Gurugram",
    experience: "0-2 Years",
    employmentType: "Full Time",
    skills: ["Lead calling", "Credit cards", "Documentation", "Sales"],
    responsibilities: [
      "Explain credit-card benefits and eligibility to customers.",
      "Collect complete application details and follow bank process.",
    ],
    requirements: [
      "Understanding of credit-card products preferred.",
      "Comfortable with targets and customer follow-ups.",
    ],
    salaryRange: "₹2.4 LPA - ₹4.2 LPA",
    status: "published",
    openingsCount: 8,
    applicationDeadline: nextDeadline(40),
    summary:
      "Help customers choose suitable credit cards from partner banks and complete applications.",
    priorityOrder: 2,
  },
  {
    title: "Operations Coordinator",
    slug: "career-operations-coordinator-noida",
    department: "Operations",
    location: "Noida",
    experience: "2-4 Years",
    employmentType: "Full Time",
    skills: ["Documentation", "Excel", "MIS", "Bank coordination"],
    responsibilities: [
      "Track application documents and pending cases.",
      "Maintain daily MIS for submitted, pending, and completed cases.",
      "Coordinate with customers, sales teams, and bank partners.",
    ],
    requirements: [
      "Prior NBFC, DSA, or banking operations experience.",
      "Detail-oriented with strong follow-up discipline.",
    ],
    salaryRange: "₹3.5 LPA - ₹5.5 LPA",
    status: "published",
    openingsCount: 3,
    applicationDeadline: nextDeadline(50),
    summary:
      "Run daily application operations and make sure customer files move cleanly.",
    priorityOrder: 3,
  },
  {
    title: "Digital Marketing Executive",
    slug: "career-digital-marketing-executive-new-delhi",
    department: "Marketing",
    location: "New Delhi",
    experience: "1-3 Years",
    employmentType: "Full Time",
    skills: ["SEO", "Performance marketing", "Content", "Analytics"],
    responsibilities: [
      "Plan campaigns for loan, insurance, and credit-card products.",
      "Coordinate landing pages, content, and performance reports.",
    ],
    requirements: [
      "Hands-on digital marketing experience.",
      "Basic understanding of financial-services funnels.",
    ],
    salaryRange: "₹3 LPA - ₹5 LPA",
    status: "published",
    openingsCount: 2,
    applicationDeadline: nextDeadline(35),
    summary:
      "Drive qualified financial-product traffic through digital campaigns and content.",
    priorityOrder: 4,
  },
];

const seed = async () => {
  try {
    await connectDB();
    for (const job of jobs) {
      await JobPosting.findOneAndUpdate(
        { title: job.title, department: job.department, location: job.location },
        job,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    console.log(`Seeded ${jobs.length} career job postings.`);
  } catch (error) {
    console.error("Career seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();
