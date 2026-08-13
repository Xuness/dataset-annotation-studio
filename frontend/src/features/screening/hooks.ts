import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CreateScreeningOperationRequest, ScreeningItemQuery } from "../../shared/api/types";
import {
  createScreeningOperation,
  getScreeningCapabilities,
  listScreeningAssetIds,
  listScreeningItems,
  listScreeningOperations,
  resumeScreeningOperation,
  stopScreeningOperation,
} from "./api";
import { screeningKeys } from "./queryKeys";

const PAGE_SIZE = 240;

export function useScreeningCapabilities(projectId: string) {
  return useQuery({
    queryKey: screeningKeys.capabilities(projectId),
    queryFn: () => getScreeningCapabilities(projectId),
    enabled: Boolean(projectId),
    retry: false,
  });
}

export function useScreeningOperations(projectId: string, forcePolling = false) {
  return useQuery({
    queryKey: screeningKeys.operations(projectId),
    queryFn: () => listScreeningOperations(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      forcePolling ||
      query.state.data?.some((operation) =>
        ["queued", "running", "stopping"].includes(operation.status),
      )
        ? 2_000
        : false,
  });
}

export function useScreeningItems(
  projectId: string,
  operationId: string | null,
  query: ScreeningItemQuery,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: screeningKeys.items(projectId, operationId ?? "", query),
    queryFn: ({ pageParam }) =>
      listScreeningItems(projectId, operationId!, {
        ...query,
        offset: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(projectId && operationId && enabled),
  });
}

export function useScreeningActions(projectId: string) {
  const queryClient = useQueryClient();
  const refreshOperations = () =>
    void queryClient.invalidateQueries({ queryKey: screeningKeys.operations(projectId) });

  return {
    create: useMutation({
      mutationFn: (request: CreateScreeningOperationRequest) =>
        createScreeningOperation(projectId, request),
      onSuccess: refreshOperations,
    }),
    stop: useMutation({
      mutationFn: (operationId: string) => stopScreeningOperation(projectId, operationId),
      onSuccess: refreshOperations,
    }),
    resume: useMutation({
      mutationFn: (operationId: string) => resumeScreeningOperation(projectId, operationId),
      onSuccess: refreshOperations,
    }),
    resolveAssetIds: useMutation({
      mutationFn: ({ operationId, query }: { operationId: string; query: ScreeningItemQuery }) =>
        listScreeningAssetIds(projectId, operationId, query),
    }),
  };
}
