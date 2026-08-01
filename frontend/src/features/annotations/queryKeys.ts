import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const annotationKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "annotations"),
  bundle: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "annotations"), "bundle", assetId] as const,
  channel: (
    projectId: string,
    assetId: string | null,
    channel: string,
    language: string,
    translationSourceKind = "",
    translationProducerKind = "",
  ) =>
    [
      ...workspaceQueryKeys.scope(projectId, "annotations"),
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ] as const,
  batchOptions: (projectId: string, assetIdsKey: string) =>
    [...workspaceQueryKeys.scope(projectId, "annotations"), "batch-options", assetIdsKey] as const,
};

export const annotationHistoryKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "annotation-history"),
  channel: (
    projectId: string,
    assetId: string | null,
    channel: string,
    language: string,
    translationSourceKind = "",
    translationProducerKind = "",
  ) =>
    [
      ...workspaceQueryKeys.scope(projectId, "annotation-history"),
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ] as const,
};
