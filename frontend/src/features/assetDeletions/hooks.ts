import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
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
    void invalidateWorkspaceMutation(queryClient, projectId, "asset-deletion-changed");
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
