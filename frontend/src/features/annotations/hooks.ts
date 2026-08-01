import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AnnotationChannel,
  AnnotationChannelTarget,
  AnnotationTag,
  AnnotationTagBatchEditExecuteRequest,
  AnnotationTagBatchEditPreviewOptions,
  AnnotationTagBatchEditRequest,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../shared/api/types";
import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
import {
  deleteAnnotationChannel,
  deleteAnnotations,
  getAnnotationBatchOptions,
  getAnnotationBundle,
  getAnnotationChannel,
  getAnnotationChannelHistory,
  reviewAnnotationChannel,
  reviewAnnotations,
  executeTagBatchEdit,
  previewTagBatchEdit,
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
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
) {
  return useQuery({
    queryKey: annotationKeys.channel(
      projectId,
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ),
    queryFn: () =>
      getAnnotationChannel(
        projectId,
        assetId!,
        channel,
        language,
        translationSourceKind,
        translationProducerKind,
      ),
    enabled: Boolean(projectId && assetId),
  });
}

export function useAnnotationChannelHistory(
  projectId: string,
  assetId: string | null,
  channel: AnnotationChannel,
  language: string,
  enabled: boolean,
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
) {
  return useQuery({
    queryKey: annotationHistoryKeys.channel(
      projectId,
      assetId,
      channel,
      language,
      translationSourceKind,
      translationProducerKind,
    ),
    queryFn: () =>
      getAnnotationChannelHistory(
        projectId,
        assetId!,
        channel,
        language,
        translationSourceKind,
        translationProducerKind,
      ),
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
    void invalidateWorkspaceMutation(queryClient, projectId, "annotation-written");
  };
}

export function useSaveAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
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
        translationSourceKind,
        translationProducerKind,
      }),
    onSuccess: invalidate,
  });
}

export function useReviewAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: (expectedHeadRevisionId: string) =>
      reviewAnnotationChannel(
        projectId,
        assetId,
        channel,
        expectedHeadRevisionId,
        language,
        translationSourceKind,
        translationProducerKind,
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnotationChannel(
  projectId: string,
  assetId: string,
  channel: AnnotationChannel,
  language = "",
  translationSourceKind: TranslationSourceKind = "description",
  translationProducerKind: TranslationProducerKind = "llm",
) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: () =>
      deleteAnnotationChannel(
        projectId,
        assetId,
        channel,
        language,
        translationSourceKind,
        translationProducerKind,
      ),
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

export function usePreviewTagBatchEdit(projectId: string) {
  return useMutation({
    mutationFn: ({
      request,
      options,
    }: {
      request: AnnotationTagBatchEditRequest;
      options?: AnnotationTagBatchEditPreviewOptions;
    }) => previewTagBatchEdit(projectId, request, options),
  });
}

export function useExecuteTagBatchEdit(projectId: string) {
  const invalidate = useInvalidateAnnotation(projectId);
  return useMutation({
    mutationFn: (request: AnnotationTagBatchEditExecuteRequest) =>
      executeTagBatchEdit(projectId, request),
    onSuccess: invalidate,
  });
}
