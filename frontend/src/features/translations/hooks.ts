import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TranslationProducerKind, TranslationSourceKind } from "../../shared/api/types";
import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
import { getTranslation, listTranslations, refreshLocalDictionaryTranslation } from "./api";
import { translationKeys } from "./queryKeys";

export function useTranslations(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: translationKeys.asset(projectId, assetId),
    queryFn: () => listTranslations(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useTranslation(
  projectId: string,
  assetId: string | null,
  language: string,
  sourceKind: TranslationSourceKind = "description",
  producerKind: TranslationProducerKind = "llm",
) {
  return useQuery({
    queryKey: translationKeys.detail(projectId, assetId, language, sourceKind, producerKind),
    queryFn: () => getTranslation(projectId, assetId!, language, sourceKind, producerKind),
    enabled: Boolean(projectId && assetId && language),
  });
}

export function useRefreshLocalDictionaryTranslation(
  projectId: string,
  assetId: string,
  language: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      expectedSourceRevisionId: string;
      expectedTranslationRevisionId: string | null;
    }) => refreshLocalDictionaryTranslation(projectId, assetId, language, input),
    onSuccess: () => invalidateWorkspaceMutation(queryClient, projectId, "translation-refreshed"),
  });
}
