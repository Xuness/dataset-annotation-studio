import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AnnotationChannel, AnnotationTag } from "../../shared/api/types";
import { annotationTraceKeys, assetKeys } from "../assets/queryKeys";
import { statisticsKeys } from "../statistics/queryKeys";
import { translationKeys } from "../translations/queryKeys";
import { workspaceKeys } from "../workspaces/queryKeys";
import {
  deleteAnnotationChannel,
  deleteAnnotations,
  getAnnotationBundle,
  getAnnotationChannel,
  getAnnotationChannelHistory,
  confirmAnnotationChannel,
  saveAnnotationChannel,
} from "./api";
import { annotationHistoryKeys, annotationKeys } from "./queryKeys";

export function useAnnotationBundle(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: annotationKeys.bundle(projectId, assetId),
    queryFn: () => getAnnotationBundle(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationChannel(
  projectId: string,
  assetId: string | null,
  channel: AnnotationChannel,
  language = "",
) {
  return useQuery({
    queryKey: annotationKeys.channel(projectId, assetId, channel, language),
    queryFn: () => getAnnotationChannel(projectId, assetId!, channel, language),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationChannelHistory(
  projectId: string,
  assetId: string | null,
  channel: AnnotationChannel,
  language: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: annotationHistoryKeys.channel(projectId, assetId, channel, language),
    queryFn: () => getAnnotationChannelHistory(projectId, assetId!, channel, language),
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

export function useSaveAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: ({
      content,
      tags,
      expectedHeadRevisionId,
      confirm,
    }: {
      content?: string;
      tags?: AnnotationTag[];
      expectedHeadRevisionId: string | null;
      confirm?: boolean;
    }) =>
      saveAnnotationChannel(projectId, assetId, channel, {
        content,
        tags,
        expectedHeadRevisionId,
        confirm,
        language,
      }),
    onSuccess: invalidate,
  });
}

export function useConfirmAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: (expectedHeadRevisionId: string) =>
      confirmAnnotationChannel(projectId, assetId, channel, expectedHeadRevisionId, language),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: () => deleteAnnotationChannel(projectId, assetId, channel, language),
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
