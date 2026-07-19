import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/database";
import {
  Banner,
  BannerStatus,
  BannerType,
} from "../modals/banner.model";

const loanProducts = [
  ["personal-loan", "Personal Loan"],
  ["education-loan", "Education Loan"],
  ["vehicle-loan", "Vehicle Loan"],
  ["gold-loan", "Gold Loan"],
  ["loan-against-car", "Loan Against Car"],
  ["car-loan", "Car Loan"],
  ["loan-against-car-value", "Loan Against Car Value"],
  ["instant-loan", "Instant Loan"],
  ["credit-score-loan", "Credit Score Loan"],
  ["loan-against-property", "Loan Against Property"],
  ["renovation-loan", "Renovation Loan"],
  ["working-capital-loan", "Working Capital Loan"],
  ["loan-against-security", "Loan Against Security"],
  ["machinery-loan", "Machinery Loan"],
  ["home-loan", "Home Loan"],
  ["business-loan", "Business Loan"],
  ["dod-loan", "DOD Loan"],
  ["od-loan", "OD Loan"],
  ["industrial-loan", "Industrial Loan"],
  ["commercial-purchases-loan", "Commercial Purchases Loan"],
  ["balance-transfer-loan", "Balance Transfer Loan"],
  ["top-up-loan", "Top Up Loan"],
  ["two-wheeler-loan", "Two Wheeler Loan"],
  ["used-car-loan", "Used Car Loan"],
  ["agriculture-loan", "Agriculture Loan"],
] as const;

const imagePath = (
  productSlug: string,
  priority: number,
  device: "desktop" | "mobile"
) =>
  `/assets/loan-banners/rendered/${productSlug}-${String(priority).padStart(
    2,
    "0"
  )}-${device}.webp`;

const heroBanner = (
  productSlug: string,
  productName: string,
  priority: 1 | 2
) => ({
  productSlug,
  title:
    priority === 1
      ? `${productName} campaign banner`
      : `Assisted ${productName} journey banner`,
  description:
    priority === 1
      ? `Purpose-built ${productName.toLowerCase()} information and application campaign.`
      : `Guided eligibility, document and partner-comparison journey for ${productName.toLowerCase()}.`,
  image: imagePath(productSlug, priority, "desktop"),
  mobileImage: imagePath(productSlug, priority, "mobile"),
  imageAlt:
    priority === 1
      ? `${productName} information with apply and EMI actions`
      : `Assisted ${productName} eligibility and documents journey`,
  linkUrl: `/products/${productSlug}`,
  buttonText: priority === 1 ? "Apply Now" : "Check Eligibility",
  secondaryLinkUrl:
    priority === 1 ? "#loan-emi-calculator" : "#loan-documents",
  secondaryButtonText: priority === 1 ? "Calculate EMI" : "View Documents",
  displayDurationMs: priority === 1 ? 5000 : 5200,
  priority,
  type: BannerType.LOAN_DETAIL,
  status: BannerStatus.ACTIVE,
});

const popupBanner = (
  productSlug: string,
  productName: string,
  device: "web" | "mobile"
) => ({
  productSlug,
  title: `${productName} offer banner`,
  description: `Apply for ${productName.toLowerCase()} through Fintaraa's secure guided journey.`,
  image: imagePath(
    productSlug,
    1,
    device === "mobile" ? "mobile" : "desktop"
  ),
  mobileImage: imagePath(productSlug, 1, "mobile"),
  imageAlt: `${productName} information and application banner`,
  linkUrl: `/products/${productSlug}`,
  buttonText: "Apply Now",
  displayDurationMs: 5000,
  priority: 1,
  type:
    device === "mobile"
      ? BannerType.LOAN_DETAIL_POPUP_MOBILE
      : BannerType.LOAN_DETAIL_POPUP_WEB,
  status: BannerStatus.ACTIVE,
});

async function seedLoanBanners() {
  await connectDB();

  const productSlugs = loanProducts.map(([productSlug]) => productSlug);
  const seededTypes = [
    BannerType.LOAN_DETAIL,
    BannerType.LOAN_DETAIL_POPUP_WEB,
    BannerType.LOAN_DETAIL_POPUP_MOBILE,
  ];

  await Banner.deleteMany({
    productSlug: { $in: productSlugs },
    type: { $in: seededTypes },
  });

  const banners = loanProducts.flatMap(([productSlug, productName]) => [
    heroBanner(productSlug, productName, 1),
    heroBanner(productSlug, productName, 2),
    popupBanner(productSlug, productName, "web"),
    popupBanner(productSlug, productName, "mobile"),
  ]);

  await Banner.insertMany(banners);

  console.log(
    `Seeded ${banners.length} page-scoped banner records for ${loanProducts.length} loan products.`
  );
}

seedLoanBanners()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
