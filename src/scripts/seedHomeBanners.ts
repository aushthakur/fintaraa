import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  Banner,
  BannerStatus,
  BannerType,
} from "../modals/banner.model";

const homeBanners = [
  {
    eyebrow: "RBI registered partner network",
    title: "Compare Loans, Insurance & Cards",
    highlightText: "from 30+ Banks",
    description:
      "One secure check. Multiple trusted offers. No CIBIL impact and instant eligibility guidance.",
    image: "/assets/home/hero-banners/financial-advisor-family.png",
    imageAlt: "Fintaraa advisor helping customers compare financial products",
    linkUrl: "/products",
    buttonText: "Explore products",
    secondaryLinkUrl: "/#eligibility-check",
    secondaryButtonText: "Check my eligibility",
    displayDurationMs: 5000,
    priority: 1,
    type: BannerType.HOMEPAGE,
    status: BannerStatus.ACTIVE,
  },
  {
    eyebrow: "Fast digital loan discovery",
    title: "Get Loan Offers",
    highlightText: "in Minutes",
    description:
      "Compare bank and NBFC options with a secure digital journey built for speed and clarity.",
    image: "/assets/home/hero-banners/instant-digital-loan.png",
    imageAlt: "Professional checking instant digital loan options on mobile",
    linkUrl: "/banks",
    buttonText: "View banks",
    secondaryLinkUrl: "/#eligibility-check",
    secondaryButtonText: "Check eligibility",
    displayDurationMs: 5200,
    priority: 2,
    type: BannerType.HOMEPAGE,
    status: BannerStatus.ACTIVE,
  },
  {
    eyebrow: "Protected tomorrow starts today",
    title: "Secure Your Family",
    highlightText: "with Better Cover",
    description:
      "Explore health, life, term, travel, and property insurance options with guided support.",
    image: "/assets/home/hero-banners/insurance-family-protection.png",
    imageAlt: "Family reviewing insurance protection options with advisor",
    linkUrl: "/products/insurance",
    buttonText: "Explore insurance",
    secondaryLinkUrl: "/#eligibility-check",
    secondaryButtonText: "Get guidance",
    displayDurationMs: 5200,
    priority: 3,
    type: BannerType.HOMEPAGE,
    status: BannerStatus.ACTIVE,
  },
  {
    eyebrow: "Smart choices, bigger rewards",
    title: "Find Credit Cards",
    highlightText: "that Reward You",
    description:
      "Pick cards for travel, fuel, shopping, cashback, and premium rewards with one clear flow.",
    image: "/assets/home/hero-banners/credit-card-rewards.png",
    imageAlt: "Professional comparing credit card rewards on mobile",
    linkUrl: "/credit-cards",
    buttonText: "Explore cards",
    secondaryLinkUrl: "/#eligibility-check",
    secondaryButtonText: "Check eligibility",
    displayDurationMs: 5200,
    priority: 4,
    type: BannerType.HOMEPAGE,
    status: BannerStatus.ACTIVE,
  },
];

async function seedHomeBanners() {
  await connectDB();

  for (const banner of homeBanners) {
    await Banner.updateOne(
      { type: BannerType.HOMEPAGE, title: banner.title },
      { $set: banner },
      { upsert: true }
    );
  }

  console.log(`Seeded ${homeBanners.length} homepage banners.`);
}

seedHomeBanners()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
