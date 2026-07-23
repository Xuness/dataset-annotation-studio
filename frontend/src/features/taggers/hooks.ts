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
  getTaggerDownloadCenter,
  getTaggerLibrary,
  importLocalTagger,
  pauseTaggerDownload,
  rescanTaggers,
  resumeTaggerDownload,
  testHuggingFaceConnection,
  updateHuggingFaceSettings,
  updateTaggerModelRoot,
  updateTaggerProfile,
  validateTaggerInstallation,
} from "./api";
import { taggerKeys } from "./queryKeys";

export function useTaggerLibrary() {
  return useQuery({ queryKey: taggerKeys.library, queryFn: getTaggerLibrary });
}

const ACTIVE_DOWNLOAD_STATUSES = new Set<TaggerDownloadStatus>([
  "queued",
  "resolving",
  "downloading",
  "verifying",
  "installing",
]);

export function useTaggerDownloadCenter() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: taggerKeys.downloads,
    queryFn: getTaggerDownloadCenter,
    refetchInterval: (query) =>
      query.state.data?.tasks.some((task) => ACTIVE_DOWNLOAD_STATUSES.has(task.status))
        ? 1_000
        : false,
  });
  const completedSignature =
    query.data?.tasks
      .filter((task) => task.status === "completed")
      .map((task) => `${task.id}:${task.installation_id ?? ""}`)
      .join("|") ?? "";
  useEffect(() => {
    if (completedSignature) {
      void queryClient.invalidateQueries({ queryKey: taggerKeys.library });
    }
  }, [completedSignature, queryClient]);
  return query;
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: taggerKeys.all });
  return {
    create: useMutation({ mutationFn: createTaggerDownload, onSuccess: refresh }),
    pause: useMutation({ mutationFn: pauseTaggerDownload, onSuccess: refresh }),
    resume: useMutation({ mutationFn: resumeTaggerDownload, onSuccess: refresh }),
    remove: useMutation({ mutationFn: deleteTaggerDownload, onSuccess: refresh }),
    saveHuggingFace: useMutation({
      mutationFn: (input: HuggingFaceSettingsUpdate) => updateHuggingFaceSettings(input),
      onSuccess: refresh,
    }),
    testHuggingFace: useMutation({ mutationFn: testHuggingFaceConnection }),
  };
}
