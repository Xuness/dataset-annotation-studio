import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  getAnnotationTrace,
  getMetadata,
  getPromptPreview,
  listAssetIds,
  listAssets,
  type AssetQuery,
} from "./api";

export function useAssets(projectId: string, query: AssetQuery) {
  return useQuery({
    queryKey: ["assets", projectId, query],
    queryFn: () => listAssets(projectId, query),
    enabled: Boolean(projectId),
  });
}

export function useInfiniteAssets(projectId: string, query: AssetQuery, pageSize = 500) {
  return useInfiniteQuery({
    queryKey: ["assets", projectId, "infinite", query, pageSize],
    queryFn: ({ pageParam }) =>
      listAssets(projectId, { ...query, offset: pageParam, limit: pageSize }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(projectId),
  });
}

export function useAssetIds(projectId: string, query: AssetQuery) {
  return useQuery({
    queryKey: ["assets", projectId, "ids", query],
    queryFn: () => listAssetIds(projectId, query),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function usePromptPreview(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["prompt-preview", projectId, assetId],
    queryFn: () => getPromptPreview(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationTrace(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["annotation-trace", projectId, assetId],
    queryFn: () => getAnnotationTrace(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
    refetchInterval: (query) => {
      const trace = query.state.data;
      if (!trace) return 5000;
      return ["queued", "running", "stopping"].includes(trace.job_status) ||
        trace.attempt_status === "running"
        ? 1000
        : false;
    },
  });
}

export function useAssetMetadata(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["metadata", projectId, assetId],
    queryFn: () => getMetadata(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}
