import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { uploadToS3 } from "../config/s3Uploader";
import {
  Banner,
  BannerStatus,
  BannerType,
  isUploadedBannerMediaUrl,
} from "../modals/banner.model";

const homeBanners = [
  {
    eyebrow: "RBI registered partner network",
    title: "Compare Loans, Insurance & Cards",
    highlightText: "from 50+ Banks",
    description:
      "One secure check. Multiple trusted offers. No CIBIL impact and instant eligibility guidance.",
    sourceImage: "/assets/home/hero-banners/financial-advisor-family.png",
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
    sourceImage: "/assets/home/hero-banners/instant-digital-loan.png",
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
    sourceImage: "/assets/home/hero-banners/insurance-family-protection.png",
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
    sourceImage: "/assets/home/hero-banners/credit-card-rewards.png",
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

const websitePublicDirectory = path.resolve(
  process.cwd(),
  "../fintaraa-website/public",
);

const resolvePublicAsset = (assetPath: string) => {
  const absolutePath = path.resolve(
    websitePublicDirectory,
    assetPath.replace(/^\/+/, ""),
  );
  const publicPrefix = `${websitePublicDirectory}${path.sep}`;
  if (!absolutePath.startsWith(publicPrefix)) {
    throw new Error(`Unsafe homepage banner asset path: ${assetPath}`);
  }
  return absolutePath;
};

async function seedHomeBanners() {
  await connectDB();

  for (const banner of homeBanners) {
    const { sourceImage, ...fields } = banner;
    const existing = await Banner.findOne({
      type: BannerType.HOMEPAGE,
      title: banner.title,
    }).lean();
    let image = isUploadedBannerMediaUrl(existing?.image)
      ? String(existing?.image)
      : "";

    if (!image) {
      image = await uploadToS3(
        await readFile(resolvePublicAsset(sourceImage)),
        path.basename(sourceImage),
        "banner",
      );
    }
    if (!isUploadedBannerMediaUrl(image)) {
      throw new Error(`Failed to upload homepage banner: ${banner.title}`);
    }

    await Banner.updateOne(
      { type: BannerType.HOMEPAGE, title: banner.title },
      {
        $set: {
          ...fields,
          image,
          mobileImage: isUploadedBannerMediaUrl(existing?.mobileImage)
            ? existing?.mobileImage
            : image,
        },
      },
      { upsert: true },
    );
  }

  console.log(
    `Seeded ${homeBanners.length} homepage banners with uploaded S3 media.`,
  );
}

seedHomeBanners()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
