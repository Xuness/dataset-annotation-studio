import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { annotationTraceKeys, assetKeys } from "../assets/queryKeys";
import { statisticsKeys } from "../statistics/queryKeys";
import { translationKeys } from "../translations/queryKeys";
import { workspaceKeys } from "../workspaces/queryKeys";
import {
  deleteAnnotation,
  deleteAnnotations,
  getAnnotation,
  getAnnotationHistory,
  saveAnnotation,
} from "./api";
import { annotationHistoryKeys, annotationKeys } from "./queryKeys";

export function useAnnotation(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: annotationKeys.detail(projectId, assetId),
    queryFn: () => getAnnotation(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationHistory(projectId: string, assetId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: annotationHistoryKeys.detail(projectId, assetId),
    queryFn: () => getAnnotationHistory(projectId, assetId!),
    enabled: Boolean(projectId && assetId && enabled),
  });
}

function useInvalidateAnnotation(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: annotationKeys.project(projectId) });
    void queryClient.invalidateQueries({
      queryKey: annotationHistoryKeys.project(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: annotationTraceKeys.project(projectId),
    });
    void queryClient.invalidateQueries({ queryKey: translationKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
    void queryClient.invalidateQueries({ queryKey: statisticsKeys.project(projectId) });
  };
}

export function useSaveAnnotation(projectId: string, assetId: string) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: ({
      content,
      expectedModifiedAt,
    }: {
      content: string;
      expectedModifiedAt: string | null;
    }) => saveAnnotation(projectId, assetId, content, expectedModifiedAt),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnotation(projectId: string, assetId: string) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: () => deleteAnnotation(projectId, assetId),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnotations(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetIds: string[]) => deleteAnnotations(projectId, assetIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: annotationKeys.project(projectId) });
      void queryClient.invalidateQueries({
        queryKey: annotationHistoryKeys.project(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: annotationTraceKeys.project(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: translationKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: statisticsKeys.project(projectId) });
    },
  });
}
