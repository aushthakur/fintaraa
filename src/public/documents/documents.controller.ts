import { Request, Response, NextFunction } from "express";

import ApiResponse from "../../utils/ApiResponse";
import { StatementDocument } from "../../modals/statement.model";

const statementTypeConfig: Record<
  string,
  { title: string; subtitle: string }
> = {
  bank_letter: {
    title: "Bank Related Letter",
    subtitle: "Bank Related Letter",
  },
  sanction_document: {
    title: "Loan Sanction Document",
    subtitle: "Loan Sanction Document",
  },
  repayment_schedule: {
    title: "Repayment Schedule",
    subtitle: "Repayment Schedule",
  },
  welcome_kit: {
    title: "Welcome Kit",
    subtitle: "Welcome Kit",
  },
  account_statement: {
    title: "Account Statement",
    subtitle: "Account Statement",
  },
  foreclosure_letter: {
    title: "Foreclosure Letter",
    subtitle: "Foreclosure Letter",
  },
  noc_letter: {
    title: "NOC Letter",
    subtitle: "NOC Letter",
  },
  disbursement_letter: {
    title: "Disbursement Letter",
    subtitle: "Disbursement Letter",
  },
};

export const getStatements = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const latest = await StatementDocument.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();
  const mapped = latest.map((doc) => ({
    id: doc._id,
    docType: doc.docType,
    title: doc.title,
    subtitle: statementTypeConfig[doc.docType]?.subtitle,
    size: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : undefined,
    issuedOn: doc.issuedOn || doc.createdAt,
    url: doc.fileUrl,
    fileName: doc.fileName,
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

  const uploadsByType = Object.keys(statementTypeConfig).reduce(
    (acc: Record<string, any[]>, key) => {
      acc[key] = req.body[key] || [];
      return acc;
    },
    {}
  );
  const totalUploads = Object.values(uploadsByType).reduce(
    (sum, list) => sum + list.length,
    0
  );
  if (totalUploads === 0) {
    return res
      .status(400)
      .json(new ApiResponse(400, [], "No files uploaded"));
  }

  const docsToCreate = Object.entries(uploadsByType).flatMap(
    ([docType, uploads]) =>
      uploads.map((item: any) => ({
        user: userId,
        docType,
        title: statementTypeConfig[docType]?.title || "Document",
        fileUrl: item.url,
        fileName: item.name || item.originalname,
        fileSize: item.size,
        fileType: item.mimetype,
        issuedOn: new Date(),
      }))
  );

  await StatementDocument.insertMany(docsToCreate);

  const latest = await StatementDocument.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();
  const mapped = latest.map((doc) => ({
    id: doc._id,
    docType: doc.docType,
    title: doc.title,
    subtitle: statementTypeConfig[doc.docType]?.subtitle,
    size: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : undefined,
    issuedOn: doc.issuedOn || doc.createdAt,
    url: doc.fileUrl,
    fileName: doc.fileName,
  }));

  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Statements uploaded successfully"));
};
