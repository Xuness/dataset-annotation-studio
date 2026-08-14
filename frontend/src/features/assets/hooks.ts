import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAnnotationTrace,
  getAnnotationTraces,
  getCandidateSummary,
  getMetadata,
  getPromptPreview,
  listAssetIds,
  listAssetFolders,
  listAssets,
  listCandidateIds,
  listSelectedAssetFolders,
  updateCandidates,
  type AssetQuery,
} from "./api";
import type { CandidateScope, CandidateUpdateRequest } from "../../shared/api/types";
import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";
import { annotationTraceKeys, assetKeys, metadataKeys, promptPreviewKeys } from "./queryKeys";

interface AssetQueryOptions {
  keepPreviousData?: boolean;
}

export function useAssets(projectId: string, query: AssetQuery, options: AssetQueryOptions = {}) {
  return useQuery({
    queryKey: assetKeys.list(projectId, query),
    queryFn: () => listAssets(projectId, query),
    placeholderData: options.keepPreviousData
      ? (previousData, previousQuery) =>
          previousQuery?.queryKey[1] === projectId ? previousData : undefined
      : undefined,
    enabled: Boolean(projectId),
  });
}

export function useInfiniteAssets(
  projectId: string,
  query: AssetQuery,
  pageSize = 500,
  options: AssetQueryOptions = {},
) {
  return useInfiniteQuery({
    queryKey: assetKeys.infinite(projectId, query, pageSize),
    queryFn: ({ pageParam }) =>
      listAssets(projectId, { ...query, offset: pageParam, limit: pageSize }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    placeholderData: options.keepPreviousData
      ? (previousData, previousQuery) =>
          previousQuery?.queryKey[1] === projectId ? previousData : undefined
      : undefined,
    enabled: Boolean(projectId),
  });
}

export function useAssetIds(projectId: string, query: AssetQuery, enabled = false) {
  return useQuery({
    queryKey: assetKeys.ids(projectId, query),
    queryFn: () => listAssetIds(projectId, query),
    enabled: Boolean(projectId) && enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAssetFolders(
  projectId: string,
  enabled = true,
  candidateScope: CandidateScope = "auto",
) {
  return useQuery({
    queryKey: assetKeys.folders(projectId, candidateScope),
    queryFn: () => listAssetFolders(projectId, candidateScope),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useSelectedAssetFolders(
  projectId: string,
  assetIds: readonly string[],
  enabled = true,
) {
  return useQuery({
    queryKey: assetKeys.selectedFolders(projectId, assetIds),
    queryFn: () => listSelectedAssetFolders(projectId, { asset_ids: [...assetIds] }),
    enabled: Boolean(projectId) && enabled && assetIds.length > 0,
  });
}

export function useCandidateSummary(projectId: string) {
  return useQuery({
    queryKey: assetKeys.candidates(projectId),
    queryFn: () => getCandidateSummary(projectId),
    enabled: Boolean(projectId),
  });
}

export function useCandidateIds(projectId: string, enabled = false) {
  return useQuery({
    queryKey: assetKeys.candidateIds(projectId),
    queryFn: () => listCandidateIds(projectId),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useCandidateActions(projectId: string) {
  const queryClient = useQueryClient();
  return {
    update: useMutation({
      mutationFn: (request: CandidateUpdateRequest) => updateCandidates(projectId, request),
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) }),
          queryClient.invalidateQueries({
            queryKey: workspaceQueryKeys.scope(projectId, "screening"),
          }),
        ]),
    }),
  };
}

export function usePromptPreview(projectId: string, assetId: string | null, enabled = true) {
  return useQuery({
    queryKey: promptPreviewKeys.detail(projectId, assetId),
    queryFn: () => getPromptPreview(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
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

export function useAnnotationTraceHistory(
  projectId: string,
  assetId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: annotationTraceKeys.history(projectId, assetId),
    queryFn: () => getAnnotationTraces(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
    refetchInterval: (query) =>
      query.state.data?.some(
        (trace) =>
          ["queued", "running", "stopping"].includes(trace.job_status) ||
          trace.attempt_status === "running",
      )
        ? 1000
        : false,
  });
}

export function useAssetMetadata(projectId: string, assetId: string | null, enabled = true) {
  return useQuery({
    queryKey: metadataKeys.detail(projectId, assetId),
    queryFn: () => getMetadata(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
  });
}
