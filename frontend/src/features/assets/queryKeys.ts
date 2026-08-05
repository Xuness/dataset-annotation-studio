import type { AssetQuery } from "./api";
import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const assetKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "assets"),
  list: (projectId: string, query: AssetQuery) =>
    [...workspaceQueryKeys.scope(projectId, "assets"), "list", query] as const,
  infinite: (projectId: string, query: AssetQuery, pageSize: number) =>
    [...workspaceQueryKeys.scope(projectId, "assets"), "infinite", query, pageSize] as const,
  ids: (projectId: string, query: AssetQuery) =>
    [...workspaceQueryKeys.scope(projectId, "assets"), "ids", query] as const,
  folders: (projectId: string) =>
    [...workspaceQueryKeys.scope(projectId, "assets"), "folders"] as const,
};

export const promptPreviewKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "prompt-preview"),
  detail: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "prompt-preview"), assetId] as const,
};

export const annotationTraceKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "annotation-trace"),
  detail: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "annotation-trace"), assetId] as const,
  history: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "annotation-trace"), assetId, "history"] as const,
};

export const metadataKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "metadata"),
  detail: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "metadata"), assetId] as const,
};
