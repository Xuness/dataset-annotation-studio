import type { ProviderType } from "../../shared/api/types";

export interface ProviderCapabilities {
  authMode: "api_key" | "codex_oauth";
  defaultBaseUrl: string;
  defaultConcurrency: number;
  modelCatalog: "openrouter" | "openai_compatible" | "opencode_go" | "codex" | null;
  requiresBaseUrl: boolean;
}

export const providerCapabilities: Record<ProviderType, ProviderCapabilities> = {
  openrouter: {
    authMode: "api_key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultConcurrency: 4,
    modelCatalog: "openrouter",
    requiresBaseUrl: true,
  },
  openai_compatible: {
    authMode: "api_key",
    defaultBaseUrl: "http://127.0.0.1:8000/v1",
    defaultConcurrency: 4,
    modelCatalog: "openai_compatible",
    requiresBaseUrl: true,
  },
  opencode_go: {
    authMode: "api_key",
    defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    defaultConcurrency: 2,
    modelCatalog: "opencode_go",
    requiresBaseUrl: true,
  },
  gemini: {
    authMode: "api_key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultConcurrency: 4,
    modelCatalog: null,
    requiresBaseUrl: true,
  },
  codex: {
    authMode: "codex_oauth",
    defaultBaseUrl: "",
    defaultConcurrency: 1,
    modelCatalog: "codex",
    requiresBaseUrl: false,
  },
};
