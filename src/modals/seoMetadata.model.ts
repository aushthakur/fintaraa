import mongoose, { Document, Schema } from "mongoose";

export interface ISeoMetadata extends Document {
  slug: string;
  type: string;
  sectionKey: string;
  pathname: string;
  title: string;
  description: string;
  keywords?: string[];
  canonicalPath?: string;
  robotsIndex?: boolean;
  robotsFollow?: boolean;
  openGraphTitle?: string;
  openGraphDescription?: string;
  openGraphImage?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  schemaEnabled?: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const SeoMetadataSchema = new Schema<ISeoMetadata>(
  {
    slug: { type: String, trim: true, unique: true, sparse: true },
    type: { type: String, default: "article", index: true },
    sectionKey: { type: String, default: "seo_metadata", index: true },
    pathname: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      sparse: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
    canonicalPath: { type: String, trim: true },
    robotsIndex: { type: Boolean, default: true },
    robotsFollow: { type: Boolean, default: true },
    openGraphTitle: { type: String, trim: true },
    openGraphDescription: { type: String, trim: true },
    openGraphImage: { type: String, trim: true },
    twitterTitle: { type: String, trim: true },
    twitterDescription: { type: String, trim: true },
    twitterImage: { type: String, trim: true },
    schemaEnabled: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

SeoMetadataSchema.pre<ISeoMetadata>("validate", function normalizePath(next) {
  if (this.pathname) {
    const cleanPath = this.pathname.trim().split("?")[0] || "/";
    this.pathname = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
    if (this.pathname.length > 1)
      this.pathname = this.pathname.replace(/\/+$/, "");
  }
  if (!this.canonicalPath) this.canonicalPath = this.pathname;
  this.sectionKey = "seo_metadata";
  this.type = "article";
  this.slug = `seo-${this.pathname
    .replace(/^\/$/, "home")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;
  next();
});

export const SeoMetadata =
  mongoose.models.SeoMetadata ||
  mongoose.model<ISeoMetadata>("SeoMetadata", SeoMetadataSchema, "knowledges");
