import type { AssetQuery } from "./api";

export const assetKeys = {
  all: ["assets"] as const,
  project: (projectId: string) => ["assets", projectId] as const,
  list: (projectId: string, query: AssetQuery) => ["assets", projectId, query] as const,
  infinite: (projectId: string, query: AssetQuery, pageSize: number) =>
    ["assets", projectId, "infinite", query, pageSize] as const,
  ids: (projectId: string, query: AssetQuery) => ["assets", projectId, "ids", query] as const,
};

export const promptPreviewKeys = {
  all: ["prompt-preview"] as const,
  project: (projectId: string) => ["prompt-preview", projectId] as const,
  detail: (projectId: string, assetId: string | null) =>
    ["prompt-preview", projectId, assetId] as const,
};

export const annotationTraceKeys = {
  all: ["annotation-trace"] as const,
  project: (projectId: string) => ["annotation-trace", projectId] as const,
  detail: (projectId: string, assetId: string | null) =>
    ["annotation-trace", projectId, assetId] as const,
};

export const metadataKeys = {
  all: ["metadata"] as const,
  project: (projectId: string) => ["metadata", projectId] as const,
  detail: (projectId: string, assetId: string | null) => ["metadata", projectId, assetId] as const,
};
