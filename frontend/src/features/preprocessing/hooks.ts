import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { assetKeys } from "../assets/queryKeys";
import { workspaceKeys } from "../workspaces/queryKeys";
import {
  executePreprocessing,
  listPreprocessOperations,
  previewPreprocessing,
  undoPreprocessOperation,
} from "./api";
import type { PreprocessExecutionOptions, PreprocessRequest } from "../../shared/api/types";
import { preprocessingKeys } from "./queryKeys";

export function usePreprocessOperations(projectId: string) {
  return useQuery({
    queryKey: preprocessingKeys.operations(projectId),
    queryFn: () => listPreprocessOperations(projectId),
  });
}

export function usePreprocessingActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: preprocessingKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
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
