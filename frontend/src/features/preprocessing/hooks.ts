import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
import {
  executePreprocessing,
  getImageProcessingBackends,
  listPreprocessOperations,
  planPreprocessingExecution,
  previewPreprocessing,
  undoPreprocessOperation,
} from "./api";
import type { PreprocessExecutionOptions, PreprocessRequest } from "../../shared/api/types";
import { preprocessingKeys } from "./queryKeys";

const activePreprocessStatuses = new Set(["running", "recovering"]);

export function usePreprocessOperations(projectId: string, forcePolling = false) {
  return useQuery({
    queryKey: preprocessingKeys.operations(projectId),
    queryFn: () => listPreprocessOperations(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      forcePolling ||
      query.state.data?.some((operation) => activePreprocessStatuses.has(operation.status))
        ? 1_000
        : false,
  });
}

export function useImageProcessingBackends() {
  return useQuery({
    queryKey: preprocessingKeys.backends,
    queryFn: getImageProcessingBackends,
    staleTime: 30_000,
    retry: false,
  });
}

export function usePreprocessExecutionPlan(
  projectId: string,
  request: PreprocessRequest,
  previewToken: string | undefined,
  execution: PreprocessExecutionOptions,
) {
  return useQuery({
    queryKey: preprocessingKeys.executionPlan(projectId, previewToken ?? "", execution),
    queryFn: () => planPreprocessingExecution(projectId, request, previewToken ?? "", execution),
    enabled: Boolean(projectId && previewToken),
    retry: false,
  });
}

export function usePreprocessingActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void invalidateWorkspaceMutation(queryClient, projectId, "preprocessing-changed");
  };
  return {
    preview: useMutation({
      mutationFn: (request: PreprocessRequest) => previewPreprocessing(projectId, request),
    }),
    execute: useMutation({
      mutationFn: ({
        request,
        previewToken,
        execution,
      }: {
        request: PreprocessRequest;
        previewToken: string;
        execution: PreprocessExecutionOptions;
      }) => executePreprocessing(projectId, request, previewToken, execution),
      onSuccess: refresh,
    }),
    undo: useMutation({
      mutationFn: (operationId: string) => undoPreprocessOperation(projectId, operationId),
      onSuccess: refresh,
    }),
  };
}
