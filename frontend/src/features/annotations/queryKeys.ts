export const annotationKeys = {
  all: ["annotation"] as const,
  detail: (projectId: string, assetId: string | null) =>
    ["annotation", projectId, assetId] as const,
};

export const annotationHistoryKeys = {
  all: ["annotation-history"] as const,
  detail: (projectId: string, assetId: string | null) =>
    ["annotation-history", projectId, assetId] as const,
};
