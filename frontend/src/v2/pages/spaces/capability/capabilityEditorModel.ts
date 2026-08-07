import type { ProviderProfileInput } from "../../../../features/presets/api";
import { providerCapabilities } from "../../../../features/presets/providerCapabilities";
import type {
  ProviderModelConfig,
  ProviderProfile,
  ProviderProtocolOptions,
  ProviderType,
  TagDictionarySearchItem,
  TaggerProfile,
  TaggerProfileInput,
} from "../../../../shared/api/types";
import type {
  CapabilityDictionarySearchItem,
  CapabilityProviderDraft,
  CapabilityProviderModelDraft,
  CapabilityProviderProtocolOption,
  CapabilityReasoningEffort,
  CapabilityTaggerProfileDraft,
} from "../spacePageModel";

const PROVIDER_LABELS: Readonly<Record<ProviderType, string>> = {
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI 兼容",
  opencode_go: "OpenCode Go",
  gemini: "Gemini 原生",
  codex: "Codex · ChatGPT OAuth",
};

export const CAPABILITY_PROVIDER_PROTOCOLS: readonly CapabilityProviderProtocolOption[] = (
  Object.keys(PROVIDER_LABELS) as ProviderType[]
).map((id) => ({
  id,
  label: PROVIDER_LABELS[id],
  defaultBaseUrl: providerCapabilities[id].defaultBaseUrl,
  defaultConcurrency: providerCapabilities[id].defaultConcurrency,
  requiresBaseUrl: providerCapabilities[id].requiresBaseUrl,
  authentication: providerCapabilities[id].authMode === "api_key" ? "api-key" : "account",
}));

export function createProviderDraft(): CapabilityProviderDraft {
  const protocol =
    CAPABILITY_PROVIDER_PROTOCOLS.find((candidate) => candidate.id === "openai_compatible") ??
    CAPABILITY_PROVIDER_PROTOCOLS[0]!;
  return {
    name: "",
    providerType: protocol.id,
    baseUrl: protocol.defaultBaseUrl,
    apiKey: "",
    concurrency: protocol.defaultConcurrency,
    defaultModelId: "",
    models: [],
  };
}

function reasoningEffort(options: ProviderProtocolOptions): CapabilityReasoningEffort | null {
  return "reasoning_effort" in options ? (options.reasoning_effort ?? null) : null;
}

function providerModelToDraft(model: ProviderModelConfig): CapabilityProviderModelDraft {
  const options = model.protocol_options;
  return {
    modelId: model.model_id,
    temperature: model.temperature,
    maxOutputTokens: model.max_output_tokens,
    timeoutSeconds: model.timeout_seconds,
    topP: model.top_p ?? null,
    seed: model.seed ?? null,
    reasoningEffort: reasoningEffort(options),
    serviceTier: options.provider_type === "openrouter" ? (options.service_tier ?? null) : null,
    promptCacheStrategy:
      options.provider_type === "openrouter" ? (options.prompt_cache_strategy ?? null) : null,
  };
}

export function providerProfileToDraft(profile: ProviderProfile): CapabilityProviderDraft {
  return {
    name: profile.name,
    providerType: profile.provider_type,
    baseUrl: profile.base_url,
    apiKey: "",
    concurrency: profile.concurrency,
    defaultModelId: profile.default_model_id,
    models: profile.models.map(providerModelToDraft),
  };
}

function protocolOptions(
  providerType: ProviderType,
  model: CapabilityProviderModelDraft,
): ProviderProtocolOptions {
  if (providerType === "openrouter") {
    return {
      provider_type: providerType,
      reasoning_effort: model.reasoningEffort,
      service_tier: model.serviceTier,
      prompt_cache_strategy: model.promptCacheStrategy,
    };
  }
  if (providerType === "gemini") return { provider_type: providerType };
  return {
    provider_type: providerType,
    reasoning_effort: model.reasoningEffort,
  };
}

export function providerDraftToInput(
  draft: CapabilityProviderDraft,
  changedProvider: boolean,
): ProviderProfileInput {
  return {
    name: draft.name.trim(),
    provider_type: draft.providerType,
    base_url: draft.baseUrl.trim(),
    api_key: draft.apiKey || (changedProvider ? "" : undefined),
    concurrency: draft.concurrency,
    default_model_id: draft.defaultModelId,
    models: draft.models.map((model) => ({
      model_id: model.modelId.trim(),
      temperature: model.temperature,
      max_output_tokens: model.maxOutputTokens,
      timeout_seconds: model.timeoutSeconds,
      top_p: model.topP,
      seed: model.seed,
      protocol_options: protocolOptions(draft.providerType, model),
    })),
  };
}

export function taggerProfileToDraft(profile: TaggerProfile): CapabilityTaggerProfileDraft {
  return {
    name: profile.name,
    installationId: profile.installation_id,
    selectionMode: profile.selection.mode,
    globalThreshold: profile.selection.global_threshold,
    categoryThresholds: { ...profile.selection.category_thresholds },
    maxTags: profile.selection.max_tags ?? null,
    categories: [...profile.categories],
    device: profile.device,
    batchSize: profile.batch_size ?? null,
  };
}

export function taggerDraftToInput(draft: CapabilityTaggerProfileDraft): TaggerProfileInput {
  return {
    name: draft.name.trim(),
    installation_id: draft.installationId,
    selection: {
      mode: draft.selectionMode,
      global_threshold: draft.globalThreshold,
      category_thresholds: { ...draft.categoryThresholds },
      max_tags: draft.maxTags,
    },
    categories: [...draft.categories],
    device: draft.device,
    batch_size: draft.batchSize,
  };
}

export function dictionarySearchItem(
  item: TagDictionarySearchItem,
): CapabilityDictionarySearchItem {
  return {
    tag: item.tag,
    normalizedTag: item.normalized_tag,
    translation: item.effective_translation ?? "",
    category: item.override?.category ?? item.category ?? "",
    source: item.source_kind === "override" ? "用户修正" : (item.source_name ?? "未命中"),
    postCount: item.post_count ?? null,
    hasOverride: Boolean(item.override),
  };
}
