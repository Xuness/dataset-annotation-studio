from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def _non_blank(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("内容不能只包含空白字符。")
    return value


class TaggerInstallationStatus(StrEnum):
    READY = "ready"
    INVALID = "invalid"
    MISSING = "missing"


class TaggerDevice(StrEnum):
    AUTO = "auto"
    CPU = "cpu"
    CUDA = "cuda"
    DIRECTML = "directml"


class TaggerFileRecord(BaseModel):
    relative_path: str
    size: int = Field(ge=0)
    modified_ns: int = Field(ge=0)
    sha256: str = Field(min_length=64, max_length=64)


class TaggerSourceRecord(BaseModel):
    source_type: Literal["local_import", "local_scan"]
    original_path: str | None = None


class TaggerInstallationManifest(BaseModel):
    manifest_version: Literal[1] = 1
    installation_id: str
    name: str
    adapter_id: str
    model_version: str
    fingerprint: str
    tag_count: int = Field(ge=1)
    categories: dict[str, int]
    files: list[TaggerFileRecord]
    source: TaggerSourceRecord
    created_at: str
    validated_at: str


class TaggerInstallation(BaseModel):
    id: str
    name: str
    adapter_id: str
    adapter_name: str
    model_version: str
    relative_path: str
    path: str
    fingerprint: str
    status: TaggerInstallationStatus
    issues: list[str] = Field(default_factory=list)
    tag_count: int = 0
    categories: dict[str, int] = Field(default_factory=dict)
    files: list[TaggerFileRecord] = Field(default_factory=list)
    source: TaggerSourceRecord | None = None
    disk_size: int = 0
    created_at: str
    updated_at: str


class TaggerAdapterSummary(BaseModel):
    id: str
    name: str
    description: str


class TaggerRuntimeInfo(BaseModel):
    available: bool
    providers: list[str] = Field(default_factory=list)
    devices: list[TaggerDevice] = Field(default_factory=list)
    error: str | None = None


class TaggerProfile(BaseModel):
    id: str
    name: str
    installation_id: str
    threshold: float = Field(ge=0.01, le=0.99)
    categories: list[str]
    device: TaggerDevice = TaggerDevice.AUTO
    concurrency: int = Field(default=1, ge=1, le=8)
    installation_name: str | None = None
    model_version: str | None = None
    ready: bool = False
    issue: str | None = None
    created_at: str
    updated_at: str


class TaggerProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    installation_id: str = Field(min_length=1)
    threshold: float = Field(default=0.55, ge=0.01, le=0.99)
    categories: list[str] = Field(default_factory=list, max_length=32)
    device: TaggerDevice = TaggerDevice.AUTO
    concurrency: int = Field(default=1, ge=1, le=8)

    _validate_name = field_validator("name")(_non_blank)

    @field_validator("categories")
    @classmethod
    def unique_categories(cls, value: list[str]) -> list[str]:
        normalized = [category.strip().casefold() for category in value if category.strip()]
        if len(normalized) != len(set(normalized)):
            raise ValueError("打标类别不能重复。")
        return normalized


class TaggerProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    installation_id: str | None = Field(default=None, min_length=1)
    threshold: float | None = Field(default=None, ge=0.01, le=0.99)
    categories: list[str] | None = Field(default=None, max_length=32)
    device: TaggerDevice | None = None
    concurrency: int | None = Field(default=None, ge=1, le=8)

    _validate_name = field_validator("name")(_non_blank)

    @field_validator("categories")
    @classmethod
    def unique_categories(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = [category.strip().casefold() for category in value if category.strip()]
        if len(normalized) != len(set(normalized)):
            raise ValueError("打标类别不能重复。")
        return normalized


class TaggerExecutionProfile(BaseModel):
    snapshot_version: Literal[1] = 1
    backend: Literal["local_tagger"] = "local_tagger"
    id: str
    name: str
    installation_id: str
    installation_name: str
    adapter_id: str
    model_version: str
    fingerprint: str
    threshold: float = Field(ge=0.01, le=0.99)
    categories: list[str]
    device: TaggerDevice
    concurrency: int = Field(ge=1, le=8)

    @model_validator(mode="after")
    def require_categories(self) -> TaggerExecutionProfile:
        if not self.categories:
            raise ValueError("本地打标配置至少需要启用一个标签类别。")
        return self

    @property
    def model_label(self) -> str:
        return f"{self.installation_name} · {self.model_version}"


class TaggerImportRequest(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=120)

    _validate_name = field_validator("name")(_non_blank)


class TaggerSettingsUpdate(BaseModel):
    model_root: str = Field(min_length=1)


class TaggerLibrary(BaseModel):
    model_root: str
    disk_size: int
    installations: list[TaggerInstallation]
    profiles: list[TaggerProfile]
    runtime: TaggerRuntimeInfo
    supported_adapters: list[TaggerAdapterSummary]
    scan_issues: list[str] = Field(default_factory=list)


class TaggerInferenceTag(BaseModel):
    name: str
    category: str
    confidence: float


class TaggerInferenceResult(BaseModel):
    content: str
    tags: list[TaggerInferenceTag]
    provider: str
    inference_ms: float
