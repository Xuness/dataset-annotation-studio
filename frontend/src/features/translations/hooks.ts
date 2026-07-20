import { useQuery } from "@tanstack/react-query";

import { getTranslation, listTranslations } from "./api";

export function useTranslations(projectId: string, assetId: string | null) {
  return useQuery({
    queryKey: ["translations", projectId, assetId],
    queryFn: () => listTranslations(projectId, assetId!),
    enabled: Boolean(projectId && assetId),
  });
}

export function useTranslation(projectId: string, assetId: string | null, language: string) {
  return useQuery({
    queryKey: ["translations", projectId, assetId, language],
    queryFn: () => getTranslation(projectId, assetId!, language),
    enabled: Boolean(projectId && assetId && language),
  });
}
