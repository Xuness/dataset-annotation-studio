from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.core.languages import normalize_language_code


def normalize_tag_key(value: str) -> str:
    if any(character in value for character in "\r\n\x00"):
        raise ValueError("Tag 不能包含换行或空字符。")
    normalized = "_".join(value.strip().casefold().split())
    if not normalized:
        raise ValueError("Tag 不能为空。")
    return normalized


def _non_blank(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise ValueError("内容不能只包含空白字符。")
    return normalized


class TagDictionaryInstallationStatus(StrEnum):
    READY = "ready"
    MISSING = "missing"
    INVALID = "invalid"


class TagDictionaryLicenseStatus(StrEnum):
    VERIFIED = "verified"
    MIXED = "mixed"
    UNDECLARED = "undeclared"


class TagDictionaryDownloadMode(StrEnum):
    DIRECT = "direct"
    MANUAL = "manual"


class TagDictionaryAdapterSummary(BaseModel):
    id: str
    name: str
    description: str
    accepted_inputs: list[str] = Field(default_factory=list)


class TagDictionarySourceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: Literal["local_import", "catalog_download"]
    source_id: str
    source_version: str
    source_url: str
    original_path: str | None = None
    offer_id: str | None = None
    revision: str | None = None
    source_sha256: str


class TagDictionaryManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest_version: int = 1
    installation_id: str
    name: str
    adapter_id: str
    adapter_version: int
    source_id: str
    source_version: str
    source_url: str
    language: str
    entry_count: int = Field(gt=0)
    fingerprint: str = Field(min_length=64, max_length=64)
    database_sha256: str = Field(min_length=64, max_length=64)
    source: TagDictionarySourceRecord
    license_id: str
    license_url: str
    license_status: TagDictionaryLicenseStatus
    installed_at: str

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        return normalize_language_code(value)


class TagDictionaryInstallation(BaseModel):
    id: str
    name: str
    adapter_id: str
    source_id: str
    source_version: str
    language: str
    path: str
    fingerprint: str
    entry_count: int = Field(gt=0)
    disk_size: int = Field(ge=0)
    enabled: bool
    priority: int = Field(ge=0)
    status: TagDictionaryInstallationStatus
    issue: str | None = None
    source_url: str
    license_id: str
    license_url: str
    license_status: TagDictionaryLicenseStatus
    created_at: str
    updated_at: str


class TagDictionaryLibrary(BaseModel):
    dictionary_root: str
    disk_size: int = Field(ge=0)
    entry_count: int = Field(ge=0)
    override_count: int = Field(ge=0)
    installations: list[TagDictionaryInstallation] = Field(default_factory=list)
    supported_adapters: list[TagDictionaryAdapterSummary] = Field(default_factory=list)
    scan_issues: list[str] = Field(default_factory=list)


class TagDictionaryImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=160)

    _validate_name = field_validator("name")(_non_blank)


class TagDictionaryInstallationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)

    _validate_name = field_validator("name")(_non_blank)

    @model_validator(mode="after")
    def require_change(self) -> TagDictionaryInstallationUpdate:
        if self.enabled is None and self.name is None:
            raise ValueError("至少需要修改一个词典属性。")
        return self


class TagDictionaryOrderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    installation_ids: list[str] = Field(min_length=1)

    @field_validator("installation_ids")
    @classmethod
    def unique_ids(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value):
            raise ValueError("词典安装 ID 不能为空。")
        if len(value) != len(set(value)):
            raise ValueError("词典排序中包含重复安装。")
        return value


class TagDictionaryOverrideUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tag: str = Field(min_length=1, max_length=500)
    translation: str = Field(min_length=1, max_length=1000)
    language: str = "zh-CN"
    category: str | None = Field(default=None, max_length=120)

    @field_validator("tag")
    @classmethod
    def validate_tag(cls, value: str) -> str:
        normalized = value.strip()
        normalize_tag_key(normalized)
        return normalized

    @field_validator("translation")
    @classmethod
    def validate_translation(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("修正译文不能为空。")
        if "\x00" in normalized:
            raise ValueError("修正译文不能包含空字符。")
        if "\n" in normalized or "\r" in normalized:
            raise ValueError("修正译文不能包含换行。")
        return normalized

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return normalize_language_code(value)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str | None) -> str | None:
        return _non_blank(value)


class TagDictionaryOverride(BaseModel):
    tag: str
    normalized_tag: str
    translation: str
    language: str
    category: str | None = None
    revision: int = Field(ge=1)
    created_at: str
    updated_at: str


class TagDictionaryResolvedEntry(BaseModel):
    requested_tag: str
    normalized_tag: str
    translation: str | None
    matched: bool
    source_kind: Literal["override", "dictionary", "fallback"]
    installation_id: str | None = None
    installation_name: str | None = None
    adapter_id: str | None = None
    source_version: str | None = None
    category: str | None = None
    post_count: int | None = None
    override_revision: int | None = None


class TagDictionaryResolution(BaseModel):
    language: str
    entries: list[TagDictionaryResolvedEntry]
    resolution_hash: str = Field(min_length=64, max_length=64)
    unmatched_count: int = Field(ge=0)


class TagDictionaryExecutionSource(BaseModel):
    installation_id: str
    name: str
    adapter_id: str
    source_id: str
    source_version: str
    fingerprint: str
    priority: int = Field(ge=0)


class TagDictionaryExecutionProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["local_dictionary"] = "local_dictionary"
    name: str = "本地 Tag 词典"
    concurrency: int = Field(default=4, ge=1, le=32)
    language: str = "zh-CN"
    sources: list[TagDictionaryExecutionSource] = Field(default_factory=list)
    override_count: int = Field(default=0, ge=0)

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        return normalize_language_code(value)


class TagDictionaryResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tags: list[str] = Field(min_length=1, max_length=5000)
    language: str = "zh-CN"

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            tag = value.strip()
            normalize_tag_key(tag)
            normalized.append(tag)
        return normalized

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return normalize_language_code(value)


class TagDictionarySearchItem(BaseModel):
    tag: str
    normalized_tag: str
    effective_translation: str | None
    source_kind: Literal["override", "dictionary", "fallback"]
    source_name: str | None = None
    installation_id: str | None = None
    adapter_id: str | None = None
    category: str | None = None
    post_count: int | None = None
    override: TagDictionaryOverride | None = None


class TagDictionarySearchResult(BaseModel):
    query: str
    language: str
    items: list[TagDictionarySearchItem] = Field(default_factory=list)
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1)
