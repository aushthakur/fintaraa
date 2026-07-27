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
  PRODUCT_SCOPED_BANNER_TYPES,
  isUploadedBannerMediaUrl,
} from "../modals/banner.model";

type LegacyBanner = Record<string, any> & {
  _id: mongoose.Types.ObjectId;
  image: string;
  mobileImage?: string;
};

type InsuranceBannerProfile = {
  slug: string;
  name: string;
  eyebrow: string;
  title: string;
  description: string;
};

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
    throw new Error(`Unsafe banner asset path: ${assetPath}`);
  }

  return absolutePath;
};

const assetMigrationId = (assetPath: string) =>
  createHash("sha256").update(assetPath).digest("hex");

const deterministicBannerId = (key: string) =>
  new mongoose.Types.ObjectId(
    createHash("sha256").update(key).digest("hex").slice(0, 24),
  );

const insuranceImagePath = (
  productSlug: string,
  priority: 1 | 2,
  device: "desktop" | "mobile",
) =>
  `/assets/insurance-banners/rendered/${productSlug}-${String(
    priority,
  ).padStart(2, "0")}-${device}.webp`;

const buildInsuranceBanners = (
  profiles: InsuranceBannerProfile[],
): LegacyBanner[] => {
  const now = new Date();

  return profiles.flatMap((profile) => {
    const common = {
      productSlug: profile.slug,
      status: BannerStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    const firstDesktop = insuranceImagePath(profile.slug, 1, "desktop");
    const firstMobile = insuranceImagePath(profile.slug, 1, "mobile");

    return [
      {
        _id: deterministicBannerId(
          `insurance:${BannerType.INSURANCE_DETAIL}:${profile.slug}:1`,
        ),
        ...common,
        type: BannerType.INSURANCE_DETAIL,
        eyebrow: profile.eyebrow,
        title: profile.title,
        description: profile.description,
        image: firstDesktop,
        mobileImage: firstMobile,
        imageAlt: `${profile.title}. Compare coverage and apply.`,
        linkUrl: `/apply/insurance/${profile.slug}`,
        buttonText: "Apply Now",
        secondaryLinkUrl: "#insurance-compare-plans",
        secondaryButtonText: "Compare Plans",
        displayDurationMs: 5200,
        priority: 1,
      },
      {
        _id: deterministicBannerId(
          `insurance:${BannerType.INSURANCE_DETAIL}:${profile.slug}:2`,
        ),
        ...common,
        type: BannerType.INSURANCE_DETAIL,
        eyebrow: `Assisted ${profile.name} journey`,
        title: `Choose ${profile.name} with Expert Guidance`,
        description:
          "Compare coverage, exclusions, documents and next steps through one secure guided journey.",
        image: insuranceImagePath(profile.slug, 2, "desktop"),
        mobileImage: insuranceImagePath(profile.slug, 2, "mobile"),
        imageAlt: `Advisor helping compare ${profile.name.toLowerCase()} options.`,
        linkUrl: `/apply/insurance/${profile.slug}`,
        buttonText: "Get Expert Help",
        secondaryLinkUrl: "#insurance-documents",
        secondaryButtonText: "View Documents",
        displayDurationMs: 5200,
        priority: 2,
      },
      {
        _id: deterministicBannerId(
          `insurance:${BannerType.INSURANCE_DETAIL_POPUP_WEB}:${profile.slug}`,
        ),
        ...common,
        type: BannerType.INSURANCE_DETAIL_POPUP_WEB,
        title: `${profile.name} web popup`,
        description: profile.description,
        image: firstDesktop,
        mobileImage: firstMobile,
        imageAlt: `${profile.name} information and application banner`,
        linkUrl: `/apply/insurance/${profile.slug}`,
        buttonText: "Apply Now",
        displayDurationMs: 5000,
        priority: 1,
      },
      {
        _id: deterministicBannerId(
          `insurance:${BannerType.INSURANCE_DETAIL_POPUP_MOBILE}:${profile.slug}`,
        ),
        ...common,
        type: BannerType.INSURANCE_DETAIL_POPUP_MOBILE,
        title: `${profile.name} mobile popup`,
        description: profile.description,
        image: firstMobile,
        mobileImage: firstMobile,
        imageAlt: `${profile.name} mobile information and application banner`,
        linkUrl: `/apply/insurance/${profile.slug}`,
        buttonText: "Apply Now",
        displayDurationMs: 5000,
        priority: 1,
      },
    ];
  });
};

const normalizeBannerActions = (source: LegacyBanner): LegacyBanner => {
  const banner = { ...source };
  const productSlug = String(banner.productSlug || "").trim().toLowerCase();
  const priority = Number(banner.priority || 1);

  if (banner.type === BannerType.LOAN_DETAIL) {
    banner.linkUrl = `/apply/loan/${productSlug}`;
    banner.buttonText = priority === 2 ? "Check Eligibility" : "Apply Now";
    banner.secondaryLinkUrl =
      priority === 2 ? "#loan-documents" : "#loan-emi-calculator";
    banner.secondaryButtonText =
      priority === 2 ? "View Documents" : "Calculate EMI";
  } else if (banner.type === BannerType.INSURANCE_DETAIL) {
    banner.linkUrl = `/apply/insurance/${productSlug}`;
    banner.buttonText = priority === 2 ? "Get Expert Help" : "Apply Now";
    banner.secondaryLinkUrl =
      priority === 2 ? "#insurance-documents" : "#insurance-compare-plans";
    banner.secondaryButtonText =
      priority === 2 ? "View Documents" : "Compare Plans";
  } else if (
    banner.type === BannerType.LOAN_DETAIL_POPUP_WEB ||
    banner.type === BannerType.LOAN_DETAIL_POPUP_MOBILE
  ) {
    banner.linkUrl = `/apply/loan/${productSlug}`;
    banner.buttonText = banner.buttonText || "Apply Now";
  } else if (
    banner.type === BannerType.INSURANCE_DETAIL_POPUP_WEB ||
    banner.type === BannerType.INSURANCE_DETAIL_POPUP_MOBILE
  ) {
    banner.linkUrl = `/apply/insurance/${productSlug}`;
    banner.buttonText = banner.buttonText || "Apply Now";
  }

  return banner;
};

async function migrateProductBannersToS3() {
  await connectDB();

  const backupCollection = mongoose.connection.collection(
    "banner_legacy_backups",
  );
  const assetMigrationCollection = mongoose.connection.collection(
    "banner_asset_migrations",
  );
  const legacyBanners = (await backupCollection
    .find({
      type: { $in: [...PRODUCT_SCOPED_BANNER_TYPES] },
    })
    .toArray()) as LegacyBanner[];
  const homepageBanners = (await Banner.find({
    type: BannerType.HOMEPAGE,
  }).lean()) as unknown as LegacyBanner[];
  const insuranceCatalogPath = path.resolve(
    process.cwd(),
    "../fintaraa-website/src/data/insuranceBannerCatalog.json",
  );
  const insuranceProfiles = JSON.parse(
    await readFile(insuranceCatalogPath, "utf8"),
  ) as InsuranceBannerProfile[];
  const insuranceBanners = buildInsuranceBanners(insuranceProfiles);
  const sourceBanners = [
    ...homepageBanners,
    ...legacyBanners,
    ...insuranceBanners,
  ];

  if (!sourceBanners.length) {
    console.log("No product banners found to migrate.");
    return;
  }

  const assetPaths = Array.from(
    new Set(
      sourceBanners.flatMap((banner) =>
        [banner.image, banner.mobileImage].filter(
          (assetPath): assetPath is string =>
            typeof assetPath === "string" && assetPath.startsWith("/assets/"),
        ),
      ),
    ),
  );
  const migratedUrls = new Map<string, string>();
  const batchSize = 5;

  for (let index = 0; index < assetPaths.length; index += batchSize) {
    const batch = assetPaths.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (assetPath) => {
        const migrationId = assetMigrationId(assetPath);
        const fileBuffer = await readFile(resolvePublicAsset(assetPath));
        const contentSha256 = createHash("sha256")
          .update(fileBuffer)
          .digest("hex");
        const existing = await assetMigrationCollection.findOne({
          _id: migrationId as any,
        });

        if (
          isUploadedBannerMediaUrl(existing?.s3Url) &&
          (!existing?.contentSha256 ||
            existing.contentSha256 === contentSha256)
        ) {
          if (!existing?.contentSha256) {
            await assetMigrationCollection.updateOne(
              { _id: migrationId as any },
              { $set: { contentSha256 } },
            );
          }
          migratedUrls.set(assetPath, String(existing?.s3Url));
          return;
        }

        const s3Url = await uploadToS3(
          fileBuffer,
          path.basename(assetPath),
          "banner",
        );

        if (!isUploadedBannerMediaUrl(s3Url)) {
          throw new Error(`S3 did not return a full URL for ${assetPath}`);
        }

        await assetMigrationCollection.updateOne(
          { _id: migrationId as any },
          {
            $set: {
              assetPath,
              s3Url,
              contentSha256,
              migratedAt: new Date(),
            },
          },
          { upsert: true },
        );
        migratedUrls.set(assetPath, s3Url);
      }),
    );

    console.log(
      `Resolved ${Math.min(index + batch.length, assetPaths.length)}/${assetPaths.length} banner assets.`,
    );
  }

  const restoredAt = new Date();
  const restoreOperations = sourceBanners.map((source) => {
    const backup = normalizeBannerActions(source);
    const {
      backedUpAt: _backedUpAt,
      backupReason: _backupReason,
      migratedAt: _previousMigration,
      ...banner
    } = backup;
    const image = migratedUrls.get(backup.image) || backup.image;
    const mobileImage = backup.mobileImage
      ? migratedUrls.get(backup.mobileImage) || backup.mobileImage
      : banner.type === BannerType.HOMEPAGE
        ? image
        : undefined;

    if (
      !isUploadedBannerMediaUrl(image) ||
      (banner.type === "loan_detail" &&
        !isUploadedBannerMediaUrl(mobileImage)) ||
      (banner.type === "insurance_detail" &&
        !isUploadedBannerMediaUrl(mobileImage))
    ) {
      throw new Error(`Incomplete S3 migration for banner ${backup._id}`);
    }

    return {
      replaceOne: {
        filter: { _id: backup._id },
        replacement: {
          ...banner,
          image,
          ...(mobileImage ? { mobileImage } : {}),
          restoredAt,
        },
        upsert: true,
      },
    };
  });

  await mongoose.connection
    .collection(Banner.collection.name)
    .bulkWrite(restoreOperations as any, { ordered: true });
  await backupCollection.updateMany(
    { _id: { $in: legacyBanners.map((banner) => banner._id) } },
    {
      $set: {
        migratedToS3At: restoredAt,
      },
    },
  );

  const restoredCount = await Banner.countDocuments({
    _id: { $in: sourceBanners.map((banner) => banner._id) },
    image: /^https?:\/\//i,
  });

  console.log(
    `Restored ${restoredCount}/${sourceBanners.length} banners with full S3 URLs (${homepageBanners.length} homepage, ${legacyBanners.length} loan, ${insuranceBanners.length} insurance).`,
  );
}

migrateProductBannersToS3()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
