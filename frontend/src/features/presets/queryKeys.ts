import type { ProviderModelSearchInput } from "./api";

export const presetKeys = {
  system: ["presets", "system"] as const,
  translationPrompts: ["presets", "translation-prompts"] as const,
  providers: ["presets", "providers"] as const,
  providerModels: ["presets", "provider-models"] as const,
  providerModelSearch: (input: ProviderModelSearchInput) =>
    [
      "presets",
      "provider-models",
      input.profile_id ?? "new",
      input.provider_type,
      input.base_url,
      input.query,
      providerCredentialCacheToken(input.api_key),
    ] as const,
  codexAccount: ["providers", "codex", "account"] as const,
  codexLogin: (loginId: string | null) => ["providers", "codex", "login", loginId] as const,
};

export function providerCredentialCacheToken(apiKey: string | null | undefined): string {
  if (!apiKey) return "absent";
  let hash = 2166136261;
  for (let index = 0; index < apiKey.length; index += 1) {
    hash ^= apiKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `present:${apiKey.length}:${(hash >>> 0).toString(16)}`;
}
