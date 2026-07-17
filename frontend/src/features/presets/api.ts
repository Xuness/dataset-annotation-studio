import { apiRequest } from "../../shared/api/client";
import type {
  CodexAccountStatus,
  CodexLoginStart,
  CodexLoginStatus,
  ProviderModelSummary,
  ProviderProfile,
  ProviderRequestOptions,
  ProviderType,
  SystemPreset,
} from "../../shared/api/types";

export interface SystemPresetInput {
  name: string;
  system_prompt: string;
}

export interface ProviderProfileInput {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  model: string;
  api_key?: string;
  temperature: number;
  max_output_tokens: number;
  concurrency: number;
  timeout_seconds: number;
  request_options: ProviderRequestOptions;
}

export interface ProviderModelSearchInput {
  profile_id?: string;
  provider_type: ProviderType;
  base_url?: string;
  api_key?: string;
  query: string;
  limit?: number;
}

export function listSystemPresets(): Promise<SystemPreset[]> {
  return apiRequest("/api/v1/presets/system");
}

export function createSystemPreset(input: SystemPresetInput): Promise<SystemPreset> {
  return apiRequest("/api/v1/presets/system", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSystemPreset(
  id: string,
  input: Partial<SystemPresetInput>,
): Promise<SystemPreset> {
  return apiRequest(`/api/v1/presets/system/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteSystemPreset(id: string): Promise<void> {
  return apiRequest(`/api/v1/presets/system/${id}`, { method: "DELETE" });
}

export function listProviderProfiles(): Promise<ProviderProfile[]> {
  return apiRequest("/api/v1/presets/providers");
}

export function createProviderProfile(input: ProviderProfileInput): Promise<ProviderProfile> {
  return apiRequest("/api/v1/presets/providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProviderProfile(
  id: string,
  input: Partial<ProviderProfileInput>,
): Promise<ProviderProfile> {
  return apiRequest(`/api/v1/presets/providers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteProviderProfile(id: string): Promise<void> {
  return apiRequest(`/api/v1/presets/providers/${id}`, { method: "DELETE" });
}

export function searchProviderModels(
  input: ProviderModelSearchInput,
): Promise<ProviderModelSummary[]> {
  return apiRequest("/api/v1/presets/provider-models/search", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCodexAccount(): Promise<CodexAccountStatus> {
  return apiRequest("/api/v1/providers/codex/account");
}

export function startCodexLogin(): Promise<CodexLoginStart> {
  return apiRequest("/api/v1/providers/codex/login", { method: "POST" });
}

export function getCodexLoginStatus(loginId: string): Promise<CodexLoginStatus> {
  return apiRequest(`/api/v1/providers/codex/login/${encodeURIComponent(loginId)}`);
}

export function cancelCodexLogin(loginId: string): Promise<void> {
  return apiRequest(`/api/v1/providers/codex/login/${encodeURIComponent(loginId)}`, {
    method: "DELETE",
  });
}
