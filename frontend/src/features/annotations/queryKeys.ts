export const annotationKeys = {
  all: ["annotation"] as const,
  project: (projectId: string) => ["annotation", projectId] as const,
  detail: (projectId: string, assetId: string | null) =>
    ["annotation", projectId, assetId] as const,
};

export const annotationHistoryKeys = {
  all: ["annotation-history"] as const,
  project: (projectId: string) => ["annotation-history", projectId] as const,
  detail: (projectId: string, assetId: string | null) =>
    ["annotation-history", projectId, assetId] as const,
};
