export const translationKeys = {
  all: ["translations"] as const,
  project: (projectId: string) => ["translations", projectId] as const,
  asset: (projectId: string, assetId: string | null) =>
    ["translations", projectId, assetId] as const,
  detail: (projectId: string, assetId: string | null, language: string) =>
    ["translations", projectId, assetId, language] as const,
};
