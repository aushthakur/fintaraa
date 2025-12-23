import { Request, Response, NextFunction } from "express";

import ApiResponse from "../../utils/ApiResponse";
import { StatementDocument } from "../../modals/statement.model";

export const getStatements = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const docs = await StatementDocument.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();
  const latest = await StatementDocument.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();
  const mapped = latest.map((doc) => ({
    id: doc._id,
    title: doc.title,
    subtitle:
      doc.docType === "bank_letter"
        ? "Bank Related Letter"
        : "Loan Sanction Document",
    size: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : undefined,
    issuedOn: doc.issuedOn || doc.createdAt,
    url: doc.fileUrl,
  }));
  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Statements fetched successfully"));
};

export const uploadStatements = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const bankUploads = req.body.bank_letter || [];
  const sanctionUploads = req.body.sanction_document || [];
  if (!bankUploads.length && !sanctionUploads.length) {
    return res
      .status(400)
      .json(new ApiResponse(400, [], "No files uploaded"));
  }

  const docsToCreate = [
    ...bankUploads.map((item: any) => ({
      user: userId,
      docType: "bank_letter",
      title: "Bank Related Letter",
      fileUrl: item.url,
      fileName: item.name || item.originalname,
      fileSize: item.size,
      fileType: item.mimetype,
      issuedOn: new Date(),
    })),
    ...sanctionUploads.map((item: any) => ({
      user: userId,
      docType: "sanction_document",
      title: "Loan Sanction Document",
      fileUrl: item.url,
      fileName: item.name || item.originalname,
      fileSize: item.size,
      fileType: item.mimetype,
      issuedOn: new Date(),
    })),
  ];

  const docs = await StatementDocument.insertMany(docsToCreate);

  const mapped = docs.map((doc) => ({
    id: doc._id,
    title: doc.title,
    subtitle:
      doc.docType === "bank_letter"
        ? "Bank Related Letter"
        : "Loan Sanction Document",
    size: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : undefined,
    issuedOn: doc.issuedOn || doc.createdAt,
    url: doc.fileUrl,
  }));

  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Statements uploaded successfully"));
};
