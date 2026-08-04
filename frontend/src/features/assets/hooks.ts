import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  getAnnotationTrace,
  getMetadata,
  getPromptPreview,
  listAssetIds,
  listAssetFolders,
  listAssets,
  type AssetQuery,
} from "./api";
import { annotationTraceKeys, assetKeys, metadataKeys, promptPreviewKeys } from "./queryKeys";

export function useAssets(projectId: string, query: AssetQuery) {
  return useQuery({
    queryKey: assetKeys.list(projectId, query),
    queryFn: () => listAssets(projectId, query),
    enabled: Boolean(projectId),
  });
}

export function useInfiniteAssets(projectId: string, query: AssetQuery, pageSize = 500) {
  return useInfiniteQuery({
    queryKey: assetKeys.infinite(projectId, query, pageSize),
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
    queryKey: assetKeys.ids(projectId, query),
    queryFn: () => listAssetIds(projectId, query),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAssetFolders(projectId: string) {
  return useQuery({
    queryKey: assetKeys.folders(projectId),
    queryFn: () => listAssetFolders(projectId),
    enabled: Boolean(projectId),
  });
}

export function usePromptPreview(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: promptPreviewKeys.detail(projectId, assetId),
    queryFn: () => getPromptPreview(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationTrace(projectId: string, assetId: string | null, enabled = true) {
  return useQuery({
    queryKey: annotationTraceKeys.detail(projectId, assetId),
    queryFn: () => getAnnotationTrace(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
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

export function useAssetMetadata(projectId: string, assetId: string | null, enabled = true) {
  return useQuery({
    queryKey: metadataKeys.detail(projectId, assetId),
    queryFn: () => getMetadata(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
  });
}
