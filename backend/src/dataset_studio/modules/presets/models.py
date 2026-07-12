from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


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
