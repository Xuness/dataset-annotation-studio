from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

from dataset_studio.modules.providers.config import (
    ProviderModelConfig,
    ProviderType,
)


def _require_non_blank(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("内容不能只包含空白字符。")
    return value


def _validate_models(
    models: list[ProviderModelConfig] | None,
) -> list[ProviderModelConfig] | None:
    if models is None:
        return None
    if not models:
        raise ValueError("至少需要保存一个模型。")
    if len(models) > 100:
        raise ValueError("每个 API 配置最多保存 100 个模型。")
    model_ids = [model.model_id for model in models]
    if len(set(model_ids)) != len(model_ids):
        raise ValueError("同一个 API 配置中不能保存重复的模型 ID。")
    return models


class SystemPreset(BaseModel):
    id: str
    name: str
    system_prompt: str
    created_at: str
    updated_at: str


class SystemPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    system_prompt: str = Field(min_length=1)

    _validate_name = field_validator("name")(_require_non_blank)
    _validate_prompt = field_validator("system_prompt")(_require_non_blank)


class SystemPresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    system_prompt: str | None = Field(default=None, min_length=1)

    _validate_name = field_validator("name")(_require_non_blank)
    _validate_prompt = field_validator("system_prompt")(_require_non_blank)


class TranslationPromptPreset(BaseModel):
    id: str
    name: str
    system_prompt: str
    created_at: str
    updated_at: str


class TranslationPromptPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    system_prompt: str = Field(min_length=1)

    _validate_name = field_validator("name")(_require_non_blank)
    _validate_prompt = field_validator("system_prompt")(_require_non_blank)


class TranslationPromptPresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    system_prompt: str | None = Field(default=None, min_length=1)

    _validate_name = field_validator("name")(_require_non_blank)
    _validate_prompt = field_validator("system_prompt")(_require_non_blank)


def _validate_profile_models(
    provider_type: ProviderType,
    default_model_id: str,
    models: list[ProviderModelConfig],
) -> tuple[str, list[ProviderModelConfig]]:
    normalized_default = default_model_id.strip()
    validated_models = _validate_models(models) or []
    model_ids = [model.model_id for model in validated_models]
    if normalized_default not in model_ids:
        raise ValueError("默认模型必须存在于当前 API 配置的模型列表中。")
    mismatched = [
        model.model_id
        for model in validated_models
        if model.protocol_options.provider_type != provider_type
    ]
    if mismatched:
        raise ValueError("模型参数协议与 API 配置协议不一致：" + "、".join(mismatched))
    return normalized_default, validated_models


class ProviderProfile(BaseModel):
    id: str
    name: str
    provider_type: ProviderType
    base_url: str
    default_model_id: str
    models: list[ProviderModelConfig]
    concurrency: int
    has_api_key: bool = False
    created_at: str
    updated_at: str

    @model_validator(mode="after")
    def validate_provider_requirements(self) -> ProviderProfile:
        if self.provider_type.requires_base_url and not self.base_url.strip():
            raise ValueError("当前供应商需要 API 地址。")
        self.default_model_id, self.models = _validate_profile_models(
            self.provider_type,
            self.default_model_id,
            self.models,
        )
        return self


class ProviderProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider_type: ProviderType
    base_url: str = ""
    default_model_id: str = Field(min_length=1, max_length=500)
    models: list[ProviderModelConfig]
    api_key: str | None = None
    concurrency: int = Field(default=4, ge=1, le=64)

    _validate_text = field_validator("name", "default_model_id")(_require_non_blank)

    @model_validator(mode="after")
    def validate_provider_requirements(self) -> ProviderProfileCreate:
        if self.provider_type.requires_base_url and not self.base_url.strip():
            raise ValueError("当前供应商需要 API 地址。")
        if self.provider_type == ProviderType.CODEX and self.api_key:
            raise ValueError("Codex 使用自身的 ChatGPT 登录，不接受 API Key。")
        self.default_model_id, self.models = _validate_profile_models(
            self.provider_type,
            self.default_model_id,
            self.models,
        )
        return self


class ProviderProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider_type: ProviderType | None = None
    base_url: str | None = None
    default_model_id: str | None = Field(default=None, min_length=1, max_length=500)
    models: list[ProviderModelConfig] | None = None
    api_key: str | None = None
    concurrency: int | None = Field(default=None, ge=1, le=64)

    _validate_text = field_validator("name", "default_model_id")(_require_non_blank)
    _validate_model_list = field_validator("models")(_validate_models)


class ProviderModelSearchRequest(BaseModel):
    profile_id: str | None = None
    provider_type: ProviderType | None = None
    base_url: str | None = None
    api_key: str | None = None
    query: str = Field(default="", max_length=200)
    limit: int = Field(default=40, ge=1, le=100)

    @model_validator(mode="after")
    def require_catalog_target(self) -> ProviderModelSearchRequest:
        if self.profile_id or self.provider_type == ProviderType.CODEX:
            return self
        if self.provider_type and self.base_url:
            return self
        raise ValueError("搜索模型需要已有 API 配置，或供应商协议与 API 地址。")
