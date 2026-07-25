export const translationKeys = {
  all: ["translations"] as const,
  project: (projectId: string) => ["translations", projectId] as const,
  asset: (projectId: string, assetId: string | null) =>
    ["translations", projectId, assetId] as const,
  detail: (
    projectId: string,
    assetId: string | null,
    language: string,
    sourceKind: string,
    producerKind: string,
  ) => ["translations", projectId, assetId, language, sourceKind, producerKind] as const,
};
