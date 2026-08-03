import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { TagDictionaryDownloadStatus } from "../../shared/api/types";
import {
  createTagDictionaryDownload,
  deleteTagDictionaryDownload,
  deleteTagDictionaryInstallation,
  deleteTagDictionaryOverride,
  getTagDictionaryDownloadCenter,
  getTagDictionaryDownloadTasks,
  getTagDictionaryLibrary,
  importTagDictionary,
  pauseTagDictionaryDownload,
  reorderTagDictionaries,
  resolveTagDictionaryEntries,
  resumeTagDictionaryDownload,
  searchTagDictionaryEntries,
  updateTagDictionaryInstallation,
  upsertTagDictionaryOverride,
} from "./api";
import { tagDictionaryKeys } from "./queryKeys";

const ACTIVE_DOWNLOAD_STATUSES = new Set<TagDictionaryDownloadStatus>([
  "queued",
  "downloading",
  "verifying",
  "installing",
]);

export function useTagDictionaryLibrary(enabled = true) {
  return useQuery({
    queryKey: tagDictionaryKeys.library,
    queryFn: getTagDictionaryLibrary,
    enabled,
  });
}

export function useTagDictionarySearch(query: string, language = "zh-CN") {
  return useQuery({
    queryKey: tagDictionaryKeys.search(query.trim(), language),
    queryFn: ({ signal }) => searchTagDictionaryEntries(query.trim(), language, signal),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  });
}

export function useTagDictionaryResolution(
  tags: ReadonlyArray<{ name: string; category: string | null }>,
  language: string,
  enabled: boolean,
) {
  const signature = JSON.stringify(tags);
  const [debouncedSignature, setDebouncedSignature] = useState(signature);

  useEffect(() => {
    if (!enabled) {
      setDebouncedSignature(signature);
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSignature(signature), 180);
    return () => window.clearTimeout(timer);
  }, [enabled, signature]);

  const requestTags = useMemo(
    () => JSON.parse(debouncedSignature) as Array<{ name: string; category: string | null }>,
    [debouncedSignature],
  );
  const settled = debouncedSignature === signature;
  const query = useQuery({
    queryKey: tagDictionaryKeys.resolution(debouncedSignature, language),
    queryFn: ({ signal }) => resolveTagDictionaryEntries(requestTags, language, signal),
    enabled: enabled && requestTags.length > 0,
    staleTime: 30_000,
  });

  return {
    ...query,
    data: settled ? query.data : undefined,
    isResolving: enabled && tags.length > 0 && (!settled || query.isFetching),
  };
}

export function useTagDictionaryDownloadCenter() {
  return useQuery({
    queryKey: tagDictionaryKeys.downloads,
    queryFn: getTagDictionaryDownloadCenter,
  });
}

export function useTagDictionaryDownloadTasks(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: tagDictionaryKeys.downloadTasks,
    queryFn: getTagDictionaryDownloadTasks,
    enabled,
    refetchInterval: (state) =>
      state.state.data?.some((task) => ACTIVE_DOWNLOAD_STATUSES.has(task.status)) ? 1_000 : false,
  });
  const completionSignature =
    query.data
      ?.filter((task) => task.status === "completed")
      .map((task) => `${task.id}:${task.installation_id ?? ""}`)
      .join("|") ?? "";
  useEffect(() => {
    if (!completionSignature) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: tagDictionaryKeys.library }),
      queryClient.invalidateQueries({
        queryKey: tagDictionaryKeys.downloads,
        exact: true,
      }),
    ]);
  }, [completionSignature, queryClient]);
  return query;
}

export function useTagDictionaryActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: tagDictionaryKeys.all });
  return {
    importLocal: useMutation({
      mutationFn: ({ path, name }: { path: string; name?: string }) =>
        importTagDictionary(path, name),
      onSuccess: refresh,
    }),
    updateInstallation: useMutation({
      mutationFn: ({ id, input }: { id: string; input: { enabled?: boolean; name?: string } }) =>
        updateTagDictionaryInstallation(id, input),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: reorderTagDictionaries,
      onSuccess: refresh,
    }),
    removeInstallation: useMutation({
      mutationFn: deleteTagDictionaryInstallation,
      onSuccess: refresh,
    }),
    upsertOverride: useMutation({
      mutationFn: upsertTagDictionaryOverride,
      onSuccess: refresh,
    }),
    removeOverride: useMutation({
      mutationFn: ({ tag, language }: { tag: string; language: string }) =>
        deleteTagDictionaryOverride(tag, language),
      onSuccess: refresh,
    }),
  };
}

export function useTagDictionaryDownloadActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: tagDictionaryKeys.downloads,
        exact: true,
      }),
      queryClient.invalidateQueries({ queryKey: tagDictionaryKeys.downloadTasks }),
    ]);
  return {
    create: useMutation({ mutationFn: createTagDictionaryDownload, onSuccess: refresh }),
    pause: useMutation({ mutationFn: pauseTagDictionaryDownload, onSuccess: refresh }),
    resume: useMutation({ mutationFn: resumeTagDictionaryDownload, onSuccess: refresh }),
    remove: useMutation({ mutationFn: deleteTagDictionaryDownload, onSuccess: refresh }),
  };
}
