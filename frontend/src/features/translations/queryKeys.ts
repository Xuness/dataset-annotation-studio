import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const translationKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "translations"),
  asset: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "translations"), "asset", assetId] as const,
  detail: (
    projectId: string,
    assetId: string | null,
    language: string,
    sourceKind: string,
    producerKind: string,
  ) =>
    [
      ...workspaceQueryKeys.scope(projectId, "translations"),
      "detail",
      assetId,
      language,
      sourceKind,
      producerKind,
    ] as const,
};
