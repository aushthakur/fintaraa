import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import connectDB from "../config/database";
import { config } from "../config/config";
import { uploadToS3 } from "../config/s3Uploader";
import {
  PopupCampaign,
  PopupCampaignStatus,
  PopupContentType,
  PopupFieldType,
  PopupFrequency,
  PopupTriggerType,
  PopupType,
} from "../modals/popupCampaign.model";

const campaignName = "Home Loan Expert Callback";
const publicAssetPath = "/assets/popups/home-loan-expert-callback.webp";
const websitePublicDirectory = path.resolve(
  process.cwd(),
  "../fintaraa-website/public",
);

const resolvePublicAsset = (assetPath: string) => {
  const absolutePath = path.resolve(
    websitePublicDirectory,
    assetPath.replace(/^\/+/, ""),
  );
  if (!absolutePath.startsWith(`${websitePublicDirectory}${path.sep}`)) {
    throw new Error(`Unsafe popup asset path: ${assetPath}`);
  }
  return absolutePath;
};

const websiteAssetUrl = (assetPath: string) =>
  `${String(config.publicWebsiteUrl || "https://fintaraa.com").replace(/\/+$/, "")}${assetPath}`;

async function seedPopupCampaigns() {
  await connectDB();

  const existing = (await PopupCampaign.findOne({ name: campaignName })
    .select("imageUrl")
    .lean()) as { imageUrl?: string } | null;
  let imageUrl = String(existing?.imageUrl || "").trim();

  if (!imageUrl) {
    imageUrl = config.s3.enabled
      ? await uploadToS3(
          await readFile(resolvePublicAsset(publicAssetPath)),
          path.basename(publicAssetPath),
          "popup",
          { cacheControl: "public, max-age=31536000, immutable" },
        )
      : websiteAssetUrl(publicAssetPath);
  }

  const result = await PopupCampaign.findOneAndUpdate(
    { name: campaignName },
    {
      $set: {
        popupType: PopupType.LEAD_CAPTURE,
        contentType: PopupContentType.IMAGE,
        heading: "Get the right home loan offer",
        description:
          "Share your requirement and a Fintaraa loan expert will call you to discuss eligible bank and NBFC options.",
        imageUrl,
        imageAlt:
          "Indian couple discussing a home loan with a financial advisor",
        ctaText: "",
        ctaUrl: "",
        triggerType: PopupTriggerType.TIME_DELAY,
        delaySeconds: 8,
        scrollPercentage: 50,
        targetPages: ["*"],
        frequency: PopupFrequency.ONCE_PER_DAY,
        formFields: [
          {
            name: "full_name",
            label: "Full name",
            type: PopupFieldType.TEXT,
            required: true,
            placeholder: "Enter your full name",
            options: [],
          },
          {
            name: "mobile",
            label: "Mobile number",
            type: PopupFieldType.TEL,
            required: true,
            placeholder: "Enter your registered mobile number",
            options: [],
          },
          {
            name: "loan_requirement",
            label: "Loan requirement",
            type: PopupFieldType.SELECT,
            required: true,
            placeholder: "Select requirement",
            options: [
              "Home Loan",
              "Home Loan Balance Transfer",
              "Home Loan Top-up",
              "Loan Against Property",
            ],
          },
          {
            name: "city",
            label: "City",
            type: PopupFieldType.TEXT,
            required: false,
            placeholder: "Enter your city",
            options: [],
          },
        ],
        submitButtonText: "Request expert callback",
        successMessage:
          "Thank you. A Fintaraa home-loan expert will contact you shortly.",
        priority: 20,
        dismissible: true,
        status: PopupCampaignStatus.ACTIVE,
        endsAt: null,
      },
      $setOnInsert: {
        name: campaignName,
        startsAt: new Date(),
      },
    },
    { new: true, upsert: true, runValidators: true },
  );

  console.log(
    `Seeded popup campaign: ${result.name} (${result.status}) image=${result.imageUrl}`,
  );
}

seedPopupCampaigns()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
