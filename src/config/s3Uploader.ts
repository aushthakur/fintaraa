import path from "path";
import { v4 as uuid } from "uuid";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { config } from "../config/config";

const s3 = new S3Client({
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId!,
    secretAccessKey: config.s3.secretAccessKey!,
  },
  ...(config.s3.baseUrl
    ? {
        endpoint: config.s3.baseUrl, // keep only if MinIO/Wasabi/LocalStack
        forcePathStyle: true,
      }
    : {}),
});

export interface S3UploadResult {
  key: string;
  url: string;
}

export interface S3DownloadResult {
  body: Buffer;
  contentType?: string;
  contentLength?: number;
}

export const uploadObjectToS3 = async (
  fileBuffer: Buffer,
  originalname: string,
  folder: string,
  opts?: {
    cacheControl?: string;
    contentDisposition?: string;
    acl?: "private" | "public-read";
    metadata?: Record<string, string>;
    serverSideEncryption?: boolean;
  },
): Promise<S3UploadResult> => {
  if (!config.s3.enabled) {
    throw new Error("S3 is disabled or not configured correctly.");
  }

  const ext = (path.extname(originalname) || ".bin").toLowerCase();
  const contentType = getContentType(ext);
  const key = `${folder}/${uuid()}${ext}`;

  const params: PutObjectCommandInput = {
    Key: key,
    Body: fileBuffer,
    Bucket: config.s3.bucket,
    ContentType: contentType,
    ContentDisposition: opts?.contentDisposition ?? "inline",
    CacheControl: opts?.cacheControl ?? "public, max-age=31536000",
    ...((opts?.serverSideEncryption ?? config.s3.serverSideEncryptionEnabled)
      ? { ServerSideEncryption: "AES256" as const }
      : {}),
    ...(opts?.acl ? { ACL: opts.acl } : {}),
    ...(opts?.metadata ? { Metadata: opts.metadata } : {}),
  };

  try {
    const command = new PutObjectCommand(params);
    const url = buildPublicUrl(key);
    await s3.send(command);

    if (config.env !== "production") console.log(`✅ Uploaded to S3 → ${url}`);
    return { key, url };
  } catch (error: any) {
    console.log("❌ S3 upload failed:", {
      code: error?.code,
      message: error?.message,
      statusCode: error?.$metadata?.httpStatusCode,
    });
    throw new Error("Failed to upload file to S3.");
  }
};

export const uploadToS3 = async (
  fileBuffer: Buffer,
  originalname: string,
  folder: string,
  opts?: {
    cacheControl?: string;
    contentDisposition?: string;
    acl?: "private" | "public-read";
    metadata?: Record<string, string>;
    serverSideEncryption?: boolean;
  },
): Promise<string> =>
  (await uploadObjectToS3(fileBuffer, originalname, folder, opts)).url;

export const downloadFromS3 = async (
  key: string,
): Promise<S3DownloadResult> => {
  if (!config.s3.enabled) {
    throw new Error("S3 is disabled or not configured.");
  }

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Key: key,
        Bucket: config.s3.bucket,
      }),
    );
    if (!response.Body) throw new Error("S3 object body is empty.");

    const bytes = await response.Body.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  } catch (error: any) {
    console.log("❌ S3 download failed:", {
      key,
      code: error?.code,
      message: error?.message,
      statusCode: error?.$metadata?.httpStatusCode,
    });
    throw new Error("Failed to download file from S3.");
  }
};

export const deleteFromS3 = async (key: string): Promise<void> => {
  if (!config.s3.enabled) {
    throw new Error("S3 is disabled or not configured.");
  }

  try {
    const command = new DeleteObjectCommand({
      Key: key,
      Bucket: config.s3.bucket,
    });
    await s3.send(command);

    if (config.env !== "production") console.log(`🗑️ Deleted from S3 → ${key}`);
  } catch (error: any) {
    console.log("❌ S3 delete failed:", {
      message: error?.message,
      code: error?.code,
      statusCode: error?.$metadata?.httpStatusCode,
    });
    throw new Error("Failed to delete file from S3.");
  }
};

const getContentType = (ext: string): string => {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
};

const buildPublicUrl = (key: string): string => {
  if (config.s3.baseUrl) {
    return `${stripTrailingSlash(config.s3.baseUrl)}/${config.s3.bucket}/${key}`;
  }
  return `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
};

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, "");
