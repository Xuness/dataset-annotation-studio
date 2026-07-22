import { useQuery } from "@tanstack/react-query";

import { getTranslation, listTranslations } from "./api";
import { translationKeys } from "./queryKeys";

export function useTranslations(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: translationKeys.asset(projectId, assetId),
    queryFn: () => listTranslations(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useTranslation(projectId: string, assetId: string | null, language: string) {
  return useQuery({
    queryKey: translationKeys.detail(projectId, assetId, language),
    queryFn: () => getTranslation(projectId, assetId!, language),
    enabled: Boolean(projectId && assetId && language),
  });
}
