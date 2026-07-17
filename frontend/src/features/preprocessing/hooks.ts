import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  executePreprocessing,
  listPreprocessOperations,
  previewPreprocessing,
  undoPreprocessOperation,
} from "./api";
import type { PreprocessExecutionOptions, PreprocessRequest } from "../../shared/api/types";

export function usePreprocessOperations(projectId: string) {
  return useQuery({
    queryKey: ["preprocessing", projectId, "operations"],
    queryFn: () => listPreprocessOperations(projectId),
  });
}

export function usePreprocessingActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["preprocessing", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["workspaces", projectId] });
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
