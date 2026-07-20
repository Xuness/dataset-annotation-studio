import type { ProviderProfileInput } from "../../../features/presets/api";
import { providerCapabilities } from "../../../features/presets/providerCapabilities";
import type {
  ProviderModelConfig,
  ProviderModelSummary,
  ProviderProfile,
  ProviderProtocolOptions,
  ProviderType,
} from "../../../shared/api/types";

export type ProviderProfileForm = ProviderProfileInput & { api_key: string };

export function createProtocolOptions(providerType: ProviderType): ProviderProtocolOptions {
  switch (providerType) {
    case "openrouter":
      return {
        provider_type: providerType,
        service_tier: null,
        reasoning_effort: null,
        prompt_cache_strategy: null,
      };
    case "openai_compatible":
    case "opencode_go":
    case "codex":
      return {
        provider_type: providerType,
        reasoning_effort: null,
      };
    case "gemini":
      return { provider_type: providerType };
  }
}

export function createModelConfig(
  providerType: ProviderType,
  modelId: string,
  summary?: ProviderModelSummary,
): ProviderModelConfig {
  const supportsTemperature =
    providerType !== "codex" &&
    !(summary?.capabilities_known && !summary.supported_parameters.includes("temperature"));
  return {
    model_id: modelId.trim(),
    temperature: supportsTemperature ? 0.2 : null,
    max_output_tokens: summary?.max_output_tokens
      ? Math.min(4096, summary.max_output_tokens)
      : 4096,
    timeout_seconds: 180,
    top_p: null,
    seed: null,
    protocol_options: createProtocolOptions(providerType),
  };
}

export function emptyProviderProfileForm(
  providerType: ProviderType = "openrouter",
): ProviderProfileForm {
  const capabilities = providerCapabilities[providerType];
  return {
    name: "",
    provider_type: providerType,
    base_url: capabilities.defaultBaseUrl,
    default_model_id: "",
    models: [],
    api_key: "",
    concurrency: capabilities.defaultConcurrency,
  };
}

export function profileToForm(profile: ProviderProfile): ProviderProfileForm {
  return {
    name: profile.name,
    provider_type: profile.provider_type,
    base_url: profile.base_url,
    default_model_id: profile.default_model_id,
    models: profile.models,
    api_key: "",
    concurrency: profile.concurrency,
  };
}
