export const annotationKeys = {
  all: ["annotation"] as const,
  project: (projectId: string) => ["annotation", projectId] as const,
  bundle: (projectId: string, assetId: string | null) =>
    ["annotation", projectId, assetId, "bundle"] as const,
  channel: (
    projectId: string,
    assetId: string | null,
    channel: string,
    language: string,
    translationSourceKind = "",
    translationProducerKind = "",
  ) =>
    [
      "annotation",
      projectId,
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ] as const,
  batchOptions: (projectId: string, assetIdsKey: string) =>
    ["annotation", projectId, "batch-options", assetIdsKey] as const,
};

export const annotationHistoryKeys = {
  all: ["annotation-history"] as const,
  project: (projectId: string) => ["annotation-history", projectId] as const,
  channel: (
    projectId: string,
    assetId: string | null,
    channel: string,
    language: string,
    translationSourceKind = "",
    translationProducerKind = "",
  ) =>
    [
      "annotation-history",
      projectId,
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ] as const,
};
