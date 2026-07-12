import { useQuery } from "@tanstack/react-query";

import { getMetadata, getPromptPreview, listAssets, type AssetQuery } from "./api";

export function useAssets(projectId: string, query: AssetQuery) {
  return useQuery({
    queryKey: ["assets", projectId, query],
    queryFn: () => listAssets(projectId, query),
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
