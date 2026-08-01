export type UploadedDocumentEvidence = {
  documentKey: string;
  fileUrl: string;
  uploadedAt: Date;
};

export const normalizeDocumentIdentity = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");

export const normalizeRequestedDocuments = (value: unknown): string[] => {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());
  const seen = new Set<string>();
  return values
    .map((item) => String(item || "").trim().slice(0, 160))
    .filter((item) => {
      const identity = normalizeDocumentIdentity(item);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, 25);
};

export const resolveRequestedDocument = (
  requestedDocuments: string[],
  candidate: unknown,
) => {
  const identity = normalizeDocumentIdentity(candidate);
  if (!identity) return null;
  return (
    requestedDocuments.find(
      (document) => normalizeDocumentIdentity(document) === identity,
    ) || null
  );
};

export const validateDocumentFileUrl = (value: unknown) => {
  const fileUrl = String(value || "").trim();
  if (!fileUrl || fileUrl.length > 2048) return null;
  try {
    const parsed = new URL(fileUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export const mergeUploadedDocumentEvidence = (
  current: Array<Partial<UploadedDocumentEvidence>> | undefined,
  next: UploadedDocumentEvidence,
): UploadedDocumentEvidence[] => {
  const byIdentity = new Map<string, UploadedDocumentEvidence>();
  (current || []).forEach((item) => {
    const documentKey = String(item.documentKey || "").trim();
    const fileUrl = validateDocumentFileUrl(item.fileUrl);
    if (!documentKey || !fileUrl) return;
    byIdentity.set(normalizeDocumentIdentity(documentKey), {
      documentKey,
      fileUrl,
      uploadedAt:
        item.uploadedAt instanceof Date
          ? item.uploadedAt
          : new Date(item.uploadedAt || Date.now()),
    });
  });
  byIdentity.set(normalizeDocumentIdentity(next.documentKey), next);
  return Array.from(byIdentity.values());
};

export const isDocumentRequestFulfilled = (
  requestedDocuments: string[],
  uploadedDocuments: Array<Partial<UploadedDocumentEvidence>> | undefined,
) => {
  const uploaded = new Set(
    (uploadedDocuments || [])
      .filter((item) => validateDocumentFileUrl(item.fileUrl))
      .map((item) => normalizeDocumentIdentity(item.documentKey)),
  );
  return (
    requestedDocuments.length > 0 &&
    requestedDocuments.every((document) =>
      uploaded.has(normalizeDocumentIdentity(document)),
    )
  );
};
