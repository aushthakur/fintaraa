import "dotenv/config";
import { createHash } from "crypto";
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

type ProductCategory = "loan" | "insurance";

type BannerProfile = {
  slug: string;
  name: string;
  eyebrow: string;
  title: string;
  description: string;
};

const assetVersion = "2026-08";
const websiteDirectory = path.resolve(process.cwd(), "../fintaraa-website");
const websitePublicDirectory = path.join(websiteDirectory, "public");

const deterministicBannerId = (category: ProductCategory, slug: string) =>
  new mongoose.Types.ObjectId(
    createHash("sha256")
      .update(`product-detail-banner:${assetVersion}:${category}:${slug}`)
      .digest("hex")
      .slice(0, 24),
  );

const assetMigrationId = (assetPath: string) =>
  createHash("sha256").update(assetPath).digest("hex");

const publicAssetPath = (
  category: ProductCategory,
  slug: string,
  device: "desktop" | "mobile",
) =>
  `/assets/product-banners/${assetVersion}/${category}/${slug}-${device}.webp`;

const resolvePublicAsset = (assetPath: string) => {
  const absolutePath = path.resolve(
    websitePublicDirectory,
    assetPath.replace(/^\/+/, ""),
  );
  const publicPrefix = `${websitePublicDirectory}${path.sep}`;
  if (!absolutePath.startsWith(publicPrefix)) {
    throw new Error(`Unsafe product banner asset path: ${assetPath}`);
  }
  return absolutePath;
};

const readProfiles = async (
  catalogFile: "loanBannerCatalog.json" | "insuranceBannerCatalog.json",
) =>
  JSON.parse(
    await readFile(
      path.join(websiteDirectory, "src/data", catalogFile),
      "utf8",
    ),
  ) as BannerProfile[];

const uploadBannerAsset = async (
  assetPath: string,
  migrationCollection: mongoose.mongo.Collection,
) => {
  const fileBuffer = await readFile(resolvePublicAsset(assetPath));
  const contentSha256 = createHash("sha256")
    .update(fileBuffer)
    .digest("hex");
  const migrationId = assetMigrationId(assetPath);
  const existing = await migrationCollection.findOne({
    _id: migrationId as any,
  });

  if (
    isUploadedBannerMediaUrl(existing?.s3Url) &&
    existing?.contentSha256 === contentSha256
  ) {
    return String(existing.s3Url);
  }

  const s3Url = await uploadToS3(
    fileBuffer,
    path.basename(assetPath),
    "product-banners",
    { cacheControl: "public, max-age=31536000, immutable" },
  );
  if (!isUploadedBannerMediaUrl(s3Url)) {
    throw new Error(`S3 did not return a full URL for ${assetPath}`);
  }

  await migrationCollection.updateOne(
    { _id: migrationId as any },
    {
      $set: {
        assetPath,
        assetVersion,
        contentSha256,
        s3Url,
        migratedAt: new Date(),
      },
    },
    { upsert: true },
  );
  return s3Url;
};

async function seedProductDetailBanners() {
  await connectDB();

  const [loanProfiles, insuranceProfiles] = await Promise.all([
    readProfiles("loanBannerCatalog.json"),
    readProfiles("insuranceBannerCatalog.json"),
  ]);
  const profiles = [
    ...loanProfiles.map((profile) => ({
      category: "loan" as const,
      profile,
    })),
    ...insuranceProfiles.map((profile) => ({
      category: "insurance" as const,
      profile,
    })),
  ];
  const assets = profiles.flatMap(({ category, profile }) => [
    publicAssetPath(category, profile.slug, "desktop"),
    publicAssetPath(category, profile.slug, "mobile"),
  ]);
  const migrationCollection = mongoose.connection.collection(
    "banner_asset_migrations",
  );
  const uploadedUrls = new Map<string, string>();
  const batchSize = 4;

  for (let index = 0; index < assets.length; index += batchSize) {
    const batch = assets.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (assetPath) => {
        uploadedUrls.set(
          assetPath,
          await uploadBannerAsset(assetPath, migrationCollection),
        );
      }),
    );
    console.log(
      `Uploaded ${Math.min(index + batch.length, assets.length)}/${assets.length} product banner assets.`,
    );
  }

  const now = new Date();
  for (const { category, profile } of profiles) {
    const type =
      category === "loan"
        ? BannerType.LOAN_DETAIL
        : BannerType.INSURANCE_DETAIL;
    const bannerId = deterministicBannerId(category, profile.slug);
    const desktopAsset = publicAssetPath(
      category,
      profile.slug,
      "desktop",
    );
    const mobileAsset = publicAssetPath(category, profile.slug, "mobile");
    const image = uploadedUrls.get(desktopAsset);
    const mobileImage = uploadedUrls.get(mobileAsset);
    if (!image || !mobileImage) {
      throw new Error(`Missing uploaded banner pair for ${profile.slug}`);
    }

    await Banner.updateOne(
      { _id: bannerId },
      {
        $set: {
          type,
          productSlug: profile.slug,
          status: BannerStatus.ACTIVE,
          priority: 1,
          eyebrow: profile.eyebrow,
          title: profile.title,
          description: profile.description,
          image,
          mobileImage,
          imageAlt: `${profile.name} product detail banner`,
          linkUrl: `/apply/${category}/${profile.slug}`,
          buttonText: category === "loan" ? "Check Eligibility" : "View Plans",
          secondaryLinkUrl:
            category === "loan"
              ? "#loan-emi-calculator"
              : "#insurance-compare-plans",
          secondaryButtonText:
            category === "loan" ? "Calculate EMI" : "Compare Plans",
          contentOverlay: true,
          displayDurationMs: 7000,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, runValidators: true },
    );

    await Banner.updateMany(
      {
        type,
        productSlug: profile.slug,
        _id: { $ne: bannerId },
      },
      {
        $set: {
          status: BannerStatus.INACTIVE,
          updatedAt: now,
        },
      },
    );
  }

  console.log(
    `Seeded ${profiles.length} responsive product banners (${loanProfiles.length} loan, ${insuranceProfiles.length} insurance).`,
  );
}

seedProductDetailBanners()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
