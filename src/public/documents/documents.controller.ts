import { Request, Response, NextFunction } from "express";

import ApiResponse from "../../utils/ApiResponse";
import { StatementDocument } from "../../modals/statement.model";
import {
  StatementFolder,
  StatementFolderDocument,
} from "../../modals/statementFolder.model";

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

export const getStatementFolders = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folders = await StatementFolder.find({ user: userId })
    .sort({ updatedAt: -1 })
    .lean();
  if (!folders.length) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], "Folders fetched successfully"));
  }

  const folderIds = folders.map((folder) => folder._id);
  const aggregates = await StatementFolderDocument.aggregate([
    { $match: { user: userId, folder: { $in: folderIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$folder",
        count: { $sum: 1 },
        latestUrl: { $first: "$fileUrl" },
        latestTitle: { $first: "$title" },
        latestCreatedAt: { $first: "$createdAt" },
      },
    },
  ]);

  const aggregateMap = new Map(
    aggregates.map((item) => [
      String(item._id),
      {
        count: item.count,
        latestUrl: item.latestUrl,
        latestTitle: item.latestTitle,
        latestCreatedAt: item.latestCreatedAt,
      },
    ])
  );

  const mapped = folders.map((folder) => {
    const stats = aggregateMap.get(String(folder._id));
    return {
      id: folder._id,
      name: folder.name,
      themeColor: folder.themeColor,
      themeIcon: folder.themeIcon,
      count: stats?.count || 0,
      latestUrl: stats?.latestUrl,
      latestTitle: stats?.latestTitle,
      updatedAt: folder.updatedAt,
      createdAt: folder.createdAt,
    };
  });

  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Folders fetched successfully"));
};

export const createStatementFolder = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json(new ApiResponse(400, [], "Name is required"));
  }

  const folder = await StatementFolder.create({
    user: userId,
    name,
    themeColor: req.body?.themeColor,
    themeIcon: req.body?.themeIcon,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, folder, "Folder created successfully"));
};

export const updateStatementFolder = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  const updates: Record<string, any> = {};
  if (req.body?.name) updates.name = String(req.body.name).trim();
  if (req.body?.themeColor) updates.themeColor = req.body.themeColor;
  if (req.body?.themeIcon) updates.themeIcon = req.body.themeIcon;

  const folder = await StatementFolder.findOneAndUpdate(
    { _id: folderId, user: userId },
    { $set: updates },
    { new: true }
  ).lean();

  if (!folder) {
    return res.status(404).json(new ApiResponse(404, [], "Folder not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, folder, "Folder updated successfully"));
};

export const deleteStatementFolder = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  const folder = await StatementFolder.findOneAndDelete({
    _id: folderId,
    user: userId,
  });

  if (!folder) {
    return res.status(404).json(new ApiResponse(404, [], "Folder not found"));
  }

  await StatementFolderDocument.deleteMany({ folder: folderId, user: userId });

  return res
    .status(200)
    .json(new ApiResponse(200, [], "Folder removed successfully"));
};

export const getStatementFolderDocuments = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  const docs = await StatementFolderDocument.find({
    folder: folderId,
    user: userId,
  })
    .sort({ createdAt: -1 })
    .lean();

  const mapped = docs.map((doc) => ({
    id: doc._id,
    folderId: doc.folder,
    title: doc.title,
    url: doc.fileUrl,
    fileName: doc.fileName,
    size: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : undefined,
    fileType: doc.fileType,
    createdAt: doc.createdAt,
  }));

  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Folder documents fetched"));
};

export const uploadStatementFolderDocuments = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  const folder = await StatementFolder.findOne({ _id: folderId, user: userId });
  if (!folder) {
    return res.status(404).json(new ApiResponse(404, [], "Folder not found"));
  }

  const uploads = req.body?.files || [];
  if (!Array.isArray(uploads) || uploads.length === 0) {
    return res
      .status(400)
      .json(new ApiResponse(400, [], "No files uploaded"));
  }

  const titles = Array.isArray(req.body?.titles)
    ? req.body.titles
    : [];

  const docsToCreate = uploads.map((item: any, index: number) => ({
    user: userId,
    folder: folderId,
    title:
      (titles[index] && String(titles[index]).trim()) ||
      item.name ||
      item.originalname ||
      "Document",
    fileUrl: item.url,
    fileName: item.name || item.originalname,
    fileSize: item.size,
    fileType: item.mimetype,
  }));

  await StatementFolderDocument.insertMany(docsToCreate);

  const docs = await StatementFolderDocument.find({
    folder: folderId,
    user: userId,
  })
    .sort({ createdAt: -1 })
    .lean();

  const mapped = docs.map((doc) => ({
    id: doc._id,
    folderId: doc.folder,
    title: doc.title,
    url: doc.fileUrl,
    fileName: doc.fileName,
    size: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : undefined,
    fileType: doc.fileType,
    createdAt: doc.createdAt,
  }));

  return res
    .status(200)
    .json(new ApiResponse(200, mapped, "Documents uploaded successfully"));
};

export const updateStatementFolderDocument = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  const docId = req.params?.docId;
  const title = String(req.body?.title || "").trim();
  if (!title) {
    return res.status(400).json(new ApiResponse(400, [], "Title is required"));
  }

  const doc = await StatementFolderDocument.findOneAndUpdate(
    { _id: docId, folder: folderId, user: userId },
    { $set: { title } },
    { new: true }
  ).lean();

  if (!doc) {
    return res.status(404).json(new ApiResponse(404, [], "Document not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, doc, "Document updated successfully"));
};

export const deleteStatementFolderDocument = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  const docId = req.params?.docId;
  const doc = await StatementFolderDocument.findOneAndDelete({
    _id: docId,
    folder: folderId,
    user: userId,
  });

  if (!doc) {
    return res.status(404).json(new ApiResponse(404, [], "Document not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, [], "Document deleted successfully"));
};

export const deleteStatementFolderDocuments = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const userId = (req as any).user?._id;
  if (!userId) {
    return res.status(401).json(new ApiResponse(401, [], "Unauthorized"));
  }

  const folderId = req.params?.id;
  await StatementFolderDocument.deleteMany({ folder: folderId, user: userId });

  return res
    .status(200)
    .json(new ApiResponse(200, [], "Folder documents cleared"));
};
