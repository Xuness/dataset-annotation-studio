import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteAnnotation, getAnnotation, getAnnotationHistory, saveAnnotation } from "./api";

export function useAnnotation(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["annotation", projectId, assetId],
    queryFn: () => getAnnotation(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationHistory(projectId: string, assetId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["annotation-history", projectId, assetId],
    queryFn: () => getAnnotationHistory(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
  });
}

function useInvalidateAnnotation(projectId: string, assetId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["annotation", projectId, assetId] });
    void queryClient.invalidateQueries({ queryKey: ["annotation-history", projectId, assetId] });
    void queryClient.invalidateQueries({ queryKey: ["annotation-trace", projectId, assetId] });
    void queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["workspaces", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["statistics", projectId] });
  };
}

export function useSaveAnnotation(projectId: string, assetId: string) {
  const invalidate = useInvalidateAnnotation(projectId, assetId);
  return useMutation({
    mutationFn: (content: string) => saveAnnotation(projectId, assetId, content),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnotation(projectId: string, assetId: string) {
  const invalidate = useInvalidateAnnotation(projectId, assetId);
  return useMutation({
    mutationFn: () => deleteAnnotation(projectId, assetId),
    onSuccess: invalidate,
  });
}
