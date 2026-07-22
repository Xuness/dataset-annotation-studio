export interface SystemPreset {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}

export interface TranslationPromptPreset {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}

export type ProviderType = "openrouter" | "openai_compatible" | "opencode_go" | "gemini" | "codex";
export type ServiceTier = "flex" | "priority";
export type ReasoningEffort = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export type PromptCacheStrategy = "explicit_system";

export interface OpenRouterModelOptions {
  provider_type: "openrouter";
  service_tier: ServiceTier | null;
  reasoning_effort: ReasoningEffort | null;
  prompt_cache_strategy: PromptCacheStrategy | null;
}

export interface OpenAICompatibleModelOptions {
  provider_type: "openai_compatible";
  reasoning_effort: ReasoningEffort | null;
}

export interface OpenCodeGoModelOptions {
  provider_type: "opencode_go";
  reasoning_effort: ReasoningEffort | null;
}

export interface GeminiModelOptions {
  provider_type: "gemini";
}

export interface CodexModelOptions {
  provider_type: "codex";
  reasoning_effort: ReasoningEffort | null;
}

export type ProviderProtocolOptions =
  | OpenRouterModelOptions
  | OpenAICompatibleModelOptions
  | OpenCodeGoModelOptions
  | GeminiModelOptions
  | CodexModelOptions;

export interface ProviderModelConfig {
  model_id: string;
  temperature: number | null;
  max_output_tokens: number;
  timeout_seconds: number;
  top_p: number | null;
  seed: number | null;
  protocol_options: ProviderProtocolOptions;
}

export interface ProviderProfile {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  default_model_id: string;
  models: ProviderModelConfig[];
  concurrency: number;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderModelSummary {
  id: string;
  name: string;
  description: string;
  context_length: number | null;
  max_output_tokens: number | null;
  input_modalities: string[];
  supported_parameters: string[];
  reasoning_efforts: string[];
  prompt_price: string | null;
  completion_price: string | null;
  capabilities_known: boolean;
}

export interface CodexAccountStatus {
  logged_in: boolean;
  uses_chatgpt: boolean;
  account_type: string | null;
  email: string | null;
  plan_type: string | null;
  requires_openai_auth: boolean;
}

export interface CodexLoginStart {
  login_id: string;
  auth_url: string;
}

export interface CodexLoginStatus {
  login_id: string;
  state: "pending" | "succeeded" | "failed" | "cancelled";
  error: string | null;
}
