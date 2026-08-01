import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type {
  HuggingFaceSettingsUpdate,
  TaggerDownloadStatus,
  TaggerProfileInput,
} from "../../shared/api/types";
import {
  createTaggerProfile,
  createTaggerDownload,
  deleteTaggerDownload,
  deleteTaggerInstallation,
  deleteTaggerProfile,
  getHuggingFaceSettings,
  getTaggerDownloadCenter,
  getTaggerDownloadTasks,
  getTaggerLibrary,
  importLocalTagger,
  pauseTaggerDownload,
  rescanTaggers,
  resumeTaggerDownload,
  searchTaggerVocabulary,
  testHuggingFaceConnection,
  updateHuggingFaceSettings,
  updateTaggerModelRoot,
  updateTaggerProfile,
  validateTaggerInstallation,
} from "./api";
import { taggerKeys } from "./queryKeys";

export function useTaggerLibrary(enabled = true) {
  return useQuery({ queryKey: taggerKeys.library, queryFn: getTaggerLibrary, enabled });
}

export function useTaggerVocabularySearch(
  installationId: string | null,
  fingerprint: string,
  query: string,
  category = "",
) {
  return useQuery({
    queryKey: taggerKeys.vocabulary(installationId ?? "", fingerprint, query, category),
    queryFn: ({ signal }) =>
      searchTaggerVocabulary(installationId!, query, {
        category: category || undefined,
        signal,
      }),
    enabled: Boolean(installationId && query.trim()),
    staleTime: 5 * 60 * 1000,
  });
}

const ACTIVE_DOWNLOAD_STATUSES = new Set<TaggerDownloadStatus>([
  "queued",
  "resolving",
  "downloading",
  "verifying",
  "installing",
]);

export function useTaggerDownloadCenter() {
  return useQuery({
    queryKey: taggerKeys.downloads,
    queryFn: getTaggerDownloadCenter,
  });
}

export function useTaggerDownloadTasks(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: taggerKeys.downloadTasks,
    queryFn: getTaggerDownloadTasks,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((task) => ACTIVE_DOWNLOAD_STATUSES.has(task.status)) ? 1_000 : false,
  });
  const completedSignature =
    query.data
      ?.filter((task) => task.status === "completed")
      .map((task) => `${task.id}:${task.installation_id ?? ""}`)
      .join("|") ?? "";
  useEffect(() => {
    if (completedSignature) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: taggerKeys.library }),
        queryClient.invalidateQueries({ queryKey: taggerKeys.downloads, exact: true }),
      ]);
    }
  }, [completedSignature, queryClient]);
  return query;
}

export function useHuggingFaceSettings() {
  return useQuery({
    queryKey: taggerKeys.huggingFace,
    queryFn: getHuggingFaceSettings,
  });
}

export function useTaggerActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: taggerKeys.all });
  return {
    setRoot: useMutation({ mutationFn: updateTaggerModelRoot, onSuccess: refresh }),
    importLocal: useMutation({
      mutationFn: ({ path, name }: { path: string; name?: string }) =>
        importLocalTagger(path, name),
      onSuccess: refresh,
    }),
    rescan: useMutation({ mutationFn: rescanTaggers, onSuccess: refresh }),
    validate: useMutation({ mutationFn: validateTaggerInstallation, onSuccess: refresh }),
    removeInstallation: useMutation({
      mutationFn: deleteTaggerInstallation,
      onSuccess: refresh,
    }),
    createProfile: useMutation({ mutationFn: createTaggerProfile, onSuccess: refresh }),
    updateProfile: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<TaggerProfileInput> }) =>
        updateTaggerProfile(id, input),
      onSuccess: refresh,
    }),
    removeProfile: useMutation({ mutationFn: deleteTaggerProfile, onSuccess: refresh }),
  };
}

export function useTaggerDownloadActions() {
  const queryClient = useQueryClient();
  const refreshDownloads = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: taggerKeys.downloads, exact: true }),
      queryClient.invalidateQueries({ queryKey: taggerKeys.downloadTasks }),
    ]);
  return {
    create: useMutation({ mutationFn: createTaggerDownload, onSuccess: refreshDownloads }),
    pause: useMutation({ mutationFn: pauseTaggerDownload, onSuccess: refreshDownloads }),
    resume: useMutation({ mutationFn: resumeTaggerDownload, onSuccess: refreshDownloads }),
    remove: useMutation({ mutationFn: deleteTaggerDownload, onSuccess: refreshDownloads }),
    saveHuggingFace: useMutation({
      mutationFn: (input: HuggingFaceSettingsUpdate) => updateHuggingFaceSettings(input),
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: taggerKeys.huggingFace,
        }),
    }),
    testHuggingFace: useMutation({ mutationFn: testHuggingFaceConnection }),
  };
}
