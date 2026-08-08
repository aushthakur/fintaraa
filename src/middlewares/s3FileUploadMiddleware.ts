import multer from "multer";
import { uploadToS3 } from "../config/s3Uploader";
import { Request, Response, NextFunction } from "express";

const memoryStorage = multer.memoryStorage();
const MAX_UPLOAD_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// Dynamically configure multer field-based upload
export const dynamicUpload = (
  fields: { name: string; maxCount?: number }[]
) => {
  return multer({
    storage: memoryStorage,
    limits: {
      fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    },
  }).fields(fields);
};

// S3 upload middleware that maps file + metadata
export const s3UploaderMiddleware = (folder: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;

      if (!files || Object.keys(files).length === 0) {
        return next();
      }

      for (const fieldName in files) {
        const uploads = await Promise.all(
          files[fieldName].map(async (file, index) => {
            const url = await uploadToS3(
              file.buffer,
              file.originalname,
              folder
            );

            const customName = Array.isArray(req.body.name)
              ? req.body.name[index] ?? file.originalname
              : req.body.name || file.originalname;

            return {
              url,
              size: file.size,
              tags: req.body.tags,
              mimetype: file.mimetype,
              originalname: file.originalname,
              name: customName || file.originalname,
            };
          })
        );

        req.body[fieldName] = uploads;
      }

      next();
    } catch (error) {
      console.log("S3 Upload Error:", error);
      res
        .status(500)
        .json({ success: false, message: "S3 Upload failed", error });
      return;
    }
  };
};
