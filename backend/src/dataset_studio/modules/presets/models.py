from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class SystemPreset(BaseModel):
    id: str
    name: str
    system_prompt: str
    created_at: str
    updated_at: str


class SystemPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    system_prompt: str = Field(min_length=1)


class SystemPresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    system_prompt: str | None = Field(default=None, min_length=1)


class ProviderType(StrEnum):
    OPENROUTER = "openrouter"
    OPENAI_COMPATIBLE = "openai_compatible"
    GEMINI = "gemini"


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


class ProviderRequestOptions(BaseModel):
    """Optional generation controls snapshotted with an API profile."""

    top_p: float | None = Field(default=None, ge=0, le=1)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    service_tier: ServiceTier | None = None
    reasoning_effort: ReasoningEffort | None = None


class ProviderProfile(BaseModel):
    id: str
    name: str
    provider_type: ProviderType
    base_url: str
    model: str
    temperature: float
    max_output_tokens: int
    concurrency: int
    timeout_seconds: int
    request_options: ProviderRequestOptions = Field(default_factory=ProviderRequestOptions)
    has_api_key: bool = False
    created_at: str
    updated_at: str


class ProviderProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider_type: ProviderType
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key: str | None = None
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int = Field(default=4096, ge=1, le=1_000_000)
    concurrency: int = Field(default=4, ge=1, le=64)
    timeout_seconds: int = Field(default=180, ge=1, le=3600)
    request_options: ProviderRequestOptions = Field(default_factory=ProviderRequestOptions)


class ProviderProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider_type: ProviderType | None = None
    base_url: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)
    api_key: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    concurrency: int | None = Field(default=None, ge=1, le=64)
    timeout_seconds: int | None = Field(default=None, ge=1, le=3600)
    request_options: ProviderRequestOptions | None = None


class ProviderModelSearchRequest(BaseModel):
    profile_id: str | None = None
    provider_type: ProviderType | None = None
    base_url: str | None = None
    api_key: str | None = None
    query: str = Field(default="", max_length=200)
    limit: int = Field(default=40, ge=1, le=100)

    @model_validator(mode="after")
    def require_catalog_target(self) -> ProviderModelSearchRequest:
        if self.profile_id or (self.provider_type and self.base_url):
            return self
        raise ValueError("搜索模型需要已有 API 配置，或供应商协议与 API 地址。")
