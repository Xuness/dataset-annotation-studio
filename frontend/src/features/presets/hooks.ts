import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createProviderProfile,
  createSystemPreset,
  deleteProviderProfile,
  deleteSystemPreset,
  listProviderProfiles,
  listSystemPresets,
  searchProviderModels,
  updateProviderProfile,
  updateSystemPreset,
  type ProviderProfileInput,
  type ProviderModelSearchInput,
  type SystemPresetInput,
} from "./api";

export const presetKeys = {
  system: ["presets", "system"] as const,
  providers: ["presets", "providers"] as const,
};

export function useSystemPresets() {
  return useQuery({ queryKey: presetKeys.system, queryFn: listSystemPresets });
}

export function useProviderProfiles() {
  return useQuery({ queryKey: presetKeys.providers, queryFn: listProviderProfiles });
}

export function useProviderModelSearch(input: ProviderModelSearchInput, enabled: boolean) {
  return useQuery({
    queryKey: [
      "presets",
      "provider-models",
      input.profile_id ?? "new",
      input.provider_type,
      input.base_url,
      input.query,
      Boolean(input.api_key),
    ],
    queryFn: () => searchProviderModels(input),
    enabled,
    staleTime: 60_000,
  });
}

export function useSystemPresetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: presetKeys.system });
    void queryClient.invalidateQueries({ queryKey: ["prompt-preview"] });
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

export function useProviderProfileMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: presetKeys.providers });
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
