from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _require_non_blank(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("模型 ID 不能只包含空白字符。")
    return normalized


class ProviderType(StrEnum):
    OPENROUTER = "openrouter"
    OPENAI_COMPATIBLE = "openai_compatible"
    OPENCODE_GO = "opencode_go"
    GEMINI = "gemini"
    CODEX = "codex"

    @property
    def requires_api_key(self) -> bool:
        return self != ProviderType.CODEX

    @property
    def requires_base_url(self) -> bool:
        return self != ProviderType.CODEX


class ServiceTier(StrEnum):
    FLEX = "flex"
    PRIORITY = "priority"


class ReasoningEffort(StrEnum):
    MAX = "max"
    XHIGH = "xhigh"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    MINIMAL = "minimal"
    NONE = "none"


class PromptCacheStrategy(StrEnum):
    """Placement strategy for an explicit prompt cache breakpoint."""

    EXPLICIT_SYSTEM = "explicit_system"


class OpenRouterModelOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: Literal[ProviderType.OPENROUTER] = ProviderType.OPENROUTER
    service_tier: ServiceTier | None = None
    reasoning_effort: ReasoningEffort | None = None
    prompt_cache_strategy: PromptCacheStrategy | None = None


class OpenAICompatibleModelOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: Literal[ProviderType.OPENAI_COMPATIBLE] = ProviderType.OPENAI_COMPATIBLE
    reasoning_effort: ReasoningEffort | None = None


class OpenCodeGoModelOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: Literal[ProviderType.OPENCODE_GO] = ProviderType.OPENCODE_GO
    reasoning_effort: ReasoningEffort | None = None


class GeminiModelOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: Literal[ProviderType.GEMINI] = ProviderType.GEMINI


class CodexModelOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: Literal[ProviderType.CODEX] = ProviderType.CODEX
    reasoning_effort: ReasoningEffort | None = None


ProviderProtocolOptions = Annotated[
    OpenRouterModelOptions
    | OpenAICompatibleModelOptions
    | OpenCodeGoModelOptions
    | GeminiModelOptions
    | CodexModelOptions,
    Field(discriminator="provider_type"),
]


def default_protocol_options(provider_type: ProviderType) -> ProviderProtocolOptions:
    if provider_type == ProviderType.OPENROUTER:
        return OpenRouterModelOptions()
    if provider_type == ProviderType.OPENAI_COMPATIBLE:
        return OpenAICompatibleModelOptions()
    if provider_type == ProviderType.OPENCODE_GO:
        return OpenCodeGoModelOptions()
    if provider_type == ProviderType.GEMINI:
        return GeminiModelOptions()
    return CodexModelOptions()


class ProviderModelConfig(BaseModel):
    """All request behavior that belongs to one model within a connection."""

    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(min_length=1, max_length=500)
    temperature: float | None = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int = Field(default=4096, ge=1, le=1_000_000)
    timeout_seconds: int = Field(default=180, ge=1, le=3600)
    top_p: float | None = Field(default=None, ge=0, le=1)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    protocol_options: ProviderProtocolOptions

    _normalize_model_id = field_validator("model_id")(_require_non_blank)


class ProviderExecutionProfile(BaseModel):
    """Immutable, single-model provider configuration stored with a job."""

    model_config = ConfigDict(extra="forbid")

    snapshot_version: Literal[2] = 2
    id: str
    name: str
    provider_type: ProviderType
    base_url: str
    concurrency: int = Field(ge=1, le=64)
    model: ProviderModelConfig

    @property
    def model_id(self) -> str:
        return self.model.model_id
