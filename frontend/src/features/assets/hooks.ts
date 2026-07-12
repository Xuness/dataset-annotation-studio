import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { getMetadata, getPromptPreview, listAssets, type AssetQuery } from "./api";

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

export function usePromptPreview(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["prompt-preview", projectId, assetId],
    queryFn: () => getPromptPreview(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAssetMetadata(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["metadata", projectId, assetId],
    queryFn: () => getMetadata(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}
