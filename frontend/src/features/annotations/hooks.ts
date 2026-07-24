import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AnnotationChannel,
  AnnotationChannelTarget,
  AnnotationTag,
} from "../../shared/api/types";
import { annotationTraceKeys, assetKeys, promptPreviewKeys } from "../assets/queryKeys";
import { statisticsKeys } from "../statistics/queryKeys";
import { translationKeys } from "../translations/queryKeys";
import { workspaceKeys } from "../workspaces/queryKeys";
import {
  deleteAnnotationChannel,
  deleteAnnotations,
  getAnnotationBatchOptions,
  getAnnotationBundle,
  getAnnotationChannel,
  getAnnotationChannelHistory,
  reviewAnnotationChannel,
  reviewAnnotations,
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

export function useAnnotationBatchOptions(projectId: string, assetIds: string[], enabled: boolean) {
  const assetIdsKey = assetIds.join("\u0000");
  return useQuery({
    queryKey: annotationKeys.batchOptions(projectId, assetIdsKey),
    queryFn: () => getAnnotationBatchOptions(projectId, assetIds),
    enabled: Boolean(projectId && assetIds.length && enabled),
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
    void queryClient.invalidateQueries({ queryKey: promptPreviewKeys.project(projectId) });
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
      review,
    }: {
      content?: string;
      tags?: AnnotationTag[];
      expectedHeadRevisionId: string | null;
      review?: boolean;
    }) =>
      saveAnnotationChannel(projectId, assetId, channel, {
        content,
        tags,
        expectedHeadRevisionId,
        review,
        language,
      }),
    onSuccess: invalidate,
  });
}

export function useReviewAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: (expectedHeadRevisionId: string) =>
      reviewAnnotationChannel(projectId, assetId, channel, expectedHeadRevisionId, language),
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
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: ({
      assetIds,
      targets,
    }: {
      assetIds: string[];
      targets: AnnotationChannelTarget[];
    }) => deleteAnnotations(projectId, assetIds, targets),
    onSuccess: invalidate,
  });
}

export function useReviewAnnotations(projectId: string) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: ({
      assetIds,
      targets,
    }: {
      assetIds: string[];
      targets: AnnotationChannelTarget[];
    }) => reviewAnnotations(projectId, assetIds, targets),
    onSuccess: invalidate,
  });
}
