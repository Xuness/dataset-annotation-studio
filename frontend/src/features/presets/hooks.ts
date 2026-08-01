import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateWorkspaceScopeAcrossProjects } from "../../shared/query/workspaceQueries";
import {
  cancelCodexLogin,
  createProviderProfile,
  createSystemPreset,
  createTranslationPromptPreset,
  deleteProviderProfile,
  deleteSystemPreset,
  deleteTranslationPromptPreset,
  getCodexAccount,
  getCodexLoginStatus,
  listProviderProfiles,
  listSystemPresets,
  listTranslationPromptPresets,
  searchProviderModels,
  startCodexLogin,
  updateProviderProfile,
  updateSystemPreset,
  updateTranslationPromptPreset,
  type ProviderProfileInput,
  type ProviderModelSearchInput,
  type SystemPresetInput,
  type TranslationPromptPresetInput,
} from "./api";
import { presetKeys } from "./queryKeys";

export function useSystemPresets() {
  return useQuery({ queryKey: presetKeys.system, queryFn: listSystemPresets });
}

export function useTranslationPromptPresets() {
  return useQuery({
    queryKey: presetKeys.translationPrompts,
    queryFn: listTranslationPromptPresets,
  });
}

export function useCodexAccount(enabled: boolean) {
  return useQuery({
    queryKey: presetKeys.codexAccount,
    queryFn: getCodexAccount,
    enabled,
    staleTime: 5_000,
  });
}

export function useCodexLoginStatus(loginId: string | null) {
  return useQuery({
    queryKey: presetKeys.codexLogin(loginId),
    queryFn: () => getCodexLoginStatus(loginId as string),
    enabled: Boolean(loginId),
    refetchInterval: (query) => (query.state.data?.state === "pending" ? 1_000 : false),
  });
}

export function useCodexAuthMutations() {
  return {
    start: useMutation({ mutationFn: startCodexLogin }),
    cancel: useMutation({ mutationFn: cancelCodexLogin }),
  };
}

export function useProviderProfiles() {
  return useQuery({ queryKey: presetKeys.providers, queryFn: listProviderProfiles });
}

export function useProviderModelSearch(input: ProviderModelSearchInput, enabled: boolean) {
  return useQuery({
    queryKey: presetKeys.providerModelSearch(input),
    queryFn: () => searchProviderModels(input),
    enabled,
    staleTime: 60_000,
  });
}

export function useSystemPresetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: presetKeys.system });
    void invalidateWorkspaceScopeAcrossProjects(queryClient, "prompt-preview");
  };
  return {
    create: useMutation({ mutationFn: createSystemPreset, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<SystemPresetInput> }) =>
        updateSystemPreset(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: deleteSystemPreset, onSuccess: invalidate }),
  };
}

export function useTranslationPromptPresetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: presetKeys.translationPrompts });
  return {
    create: useMutation({
      mutationFn: createTranslationPromptPreset,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<TranslationPromptPresetInput> }) =>
        updateTranslationPromptPreset(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: deleteTranslationPromptPreset,
      onSuccess: invalidate,
    }),
  };
}

export function useProviderProfileMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: presetKeys.providers }),
      queryClient.invalidateQueries({ queryKey: presetKeys.providerModels }),
    ]);
  return {
    create: useMutation({ mutationFn: createProviderProfile, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<ProviderProfileInput> }) =>
        updateProviderProfile(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: deleteProviderProfile, onSuccess: invalidate }),
  };
}
