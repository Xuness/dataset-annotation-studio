import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { annotationKeys } from "../annotations/queryKeys";
import { assetKeys } from "../assets/queryKeys";
import { statisticsKeys } from "../statistics/queryKeys";
import { translationKeys } from "../translations/queryKeys";
import { workspaceKeys } from "../workspaces/queryKeys";
import {
  executeAssetDeletion,
  listAssetDeletions,
  previewAssetDeletion,
  undoAssetDeletion,
} from "./api";
import { assetDeletionKeys } from "./queryKeys";

export function useAssetDeletionOperations(projectId: string, enabled = true) {
  return useQuery({
    queryKey: assetDeletionKeys.project(projectId),
    queryFn: () => listAssetDeletions(projectId),
    enabled: Boolean(projectId && enabled),
  });
}

export function useAssetDeletionActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: assetDeletionKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: annotationKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: translationKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
    void queryClient.invalidateQueries({ queryKey: statisticsKeys.project(projectId) });
  };

  return {
    preview: useMutation({
      mutationFn: (assetIds: string[]) => previewAssetDeletion(projectId, assetIds),
    }),
    execute: useMutation({
      mutationFn: ({ assetIds, previewToken }: { assetIds: string[]; previewToken: string }) =>
        executeAssetDeletion(projectId, assetIds, previewToken),
      onSuccess: refresh,
    }),
    undo: useMutation({
      mutationFn: (operationId: string) => undoAssetDeletion(projectId, operationId),
      onSuccess: refresh,
    }),
  };
}
