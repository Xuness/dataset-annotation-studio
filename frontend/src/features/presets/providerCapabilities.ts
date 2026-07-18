import type { ProviderType } from "../../shared/api/types";

export interface ProviderCapabilities {
  authMode: "api_key" | "codex_oauth";
  defaultBaseUrl: string;
  defaultConcurrency: number;
  modelCatalog: "openrouter" | "opencode_go" | "codex" | null;
  requiresBaseUrl: boolean;
  supportsPromptCache: boolean;
  supportsReasoningEffort: boolean;
  supportsSamplingControls: boolean;
  supportsServiceTier: boolean;
}

export const providerCapabilities: Record<ProviderType, ProviderCapabilities> = {
  openrouter: {
    authMode: "api_key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultConcurrency: 4,
    modelCatalog: "openrouter",
    requiresBaseUrl: true,
    supportsPromptCache: true,
    supportsReasoningEffort: true,
    supportsSamplingControls: true,
    supportsServiceTier: true,
  },
  openai_compatible: {
    authMode: "api_key",
    defaultBaseUrl: "http://127.0.0.1:8000/v1",
    defaultConcurrency: 4,
    modelCatalog: null,
    requiresBaseUrl: true,
    supportsPromptCache: false,
    supportsReasoningEffort: false,
    supportsSamplingControls: true,
    supportsServiceTier: false,
  },
  opencode_go: {
    authMode: "api_key",
    defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    defaultConcurrency: 2,
    modelCatalog: "opencode_go",
    requiresBaseUrl: true,
    supportsPromptCache: false,
    supportsReasoningEffort: false,
    supportsSamplingControls: false,
    supportsServiceTier: false,
  },
  gemini: {
    authMode: "api_key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultConcurrency: 4,
    modelCatalog: null,
    requiresBaseUrl: true,
    supportsPromptCache: false,
    supportsReasoningEffort: false,
    supportsSamplingControls: true,
    supportsServiceTier: false,
  },
  codex: {
    authMode: "codex_oauth",
    defaultBaseUrl: "",
    defaultConcurrency: 1,
    modelCatalog: "codex",
    requiresBaseUrl: false,
    supportsPromptCache: false,
    supportsReasoningEffort: true,
    supportsSamplingControls: false,
    supportsServiceTier: false,
  },
};
