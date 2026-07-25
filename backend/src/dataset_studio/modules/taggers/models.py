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


class TaggerSelectionMode(StrEnum):
    GLOBAL = "global"
    CATEGORY = "category"
    MODEL_RECOMMENDED = "model_recommended"


class TaggerSelectionPolicy(BaseModel):
    mode: TaggerSelectionMode = TaggerSelectionMode.GLOBAL
    global_threshold: float = Field(default=0.55, ge=0.01, le=0.99)
    category_thresholds: dict[str, float] = Field(default_factory=dict, max_length=32)
    max_tags: int | None = Field(default=None, ge=1, le=10_000)

    @field_validator("category_thresholds")
    @classmethod
    def normalize_category_thresholds(cls, value: dict[str, float]) -> dict[str, float]:
        normalized: dict[str, float] = {}
        for raw_category, threshold in value.items():
            category = raw_category.strip().casefold()
            if not category:
                raise ValueError("分类阈值的类别名不能为空。")
            if category in normalized:
                raise ValueError("分类阈值的类别名不能重复。")
            if not 0.01 <= float(threshold) <= 0.99:
                raise ValueError("分类阈值必须位于 0.01 到 0.99 之间。")
            normalized[category] = float(threshold)
        return normalized


class TaggerProfileCapabilities(BaseModel):
    supported_selection_modes: list[TaggerSelectionMode] = Field(min_length=1)
    default_selection: TaggerSelectionPolicy
    default_categories: list[str] = Field(min_length=1, max_length=32)

    @field_validator("supported_selection_modes")
    @classmethod
    def unique_modes(cls, value: list[TaggerSelectionMode]) -> list[TaggerSelectionMode]:
        if len(value) != len(set(value)):
            raise ValueError("打标器支持的选择模式不能重复。")
        return value

    @field_validator("default_categories")
    @classmethod
    def normalize_default_categories(cls, value: list[str]) -> list[str]:
        normalized = [category.strip().casefold() for category in value if category.strip()]
        if len(normalized) != len(set(normalized)):
            raise ValueError("打标器默认类别不能重复。")
        return normalized

    @model_validator(mode="after")
    def validate_default_mode(self) -> TaggerProfileCapabilities:
        if self.default_selection.mode not in self.supported_selection_modes:
            raise ValueError("默认标签选择模式不在打标器支持范围内。")
        return self


class TaggerFileRecord(BaseModel):
    relative_path: str
    size: int = Field(ge=0)
    modified_ns: int = Field(ge=0)
    sha256: str = Field(min_length=64, max_length=64)


class TaggerSourceRecord(BaseModel):
    source_type: Literal["local_import", "local_scan", "huggingface"]
    original_path: str | None = None
    plan_id: str | None = None
    repo_id: str | None = None
    revision: str | None = None

    @model_validator(mode="after")
    def validate_source_fields(self) -> TaggerSourceRecord:
        if self.source_type == "huggingface":
            if not self.plan_id or not self.repo_id or not self.revision:
                raise ValueError("Hugging Face 安装来源缺少下载计划、仓库或 revision。")
            if len(self.revision) != 40:
                raise ValueError("Hugging Face 安装来源 revision 无效。")
        elif self.plan_id is not None or self.repo_id is not None or self.revision is not None:
            raise ValueError("本地安装来源不能包含 Hugging Face 字段。")
        return self


class TaggerInstallationManifest(BaseModel):
    manifest_version: Literal[1, 2, 3] = 3
    installation_id: str
    name: str
    adapter_id: str
    adapter_contract_version: int = Field(default=1, ge=1)
    model_version: str
    fingerprint: str
    tag_count: int = Field(ge=1)
    categories: dict[str, int]
    profile_capabilities: TaggerProfileCapabilities | None = None
    warnings: list[str] = Field(default_factory=list)
    files: list[TaggerFileRecord]
    source: TaggerSourceRecord
    created_at: str
    validated_at: str


class TaggerInstallation(BaseModel):
    id: str
    name: str
    adapter_id: str
    adapter_name: str
    adapter_contract_version: int = Field(default=1, ge=1)
    model_version: str
    relative_path: str
    path: str
    fingerprint: str
    status: TaggerInstallationStatus
    issues: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    tag_count: int = 0
    categories: dict[str, int] = Field(default_factory=dict)
    profile_capabilities: TaggerProfileCapabilities
    files: list[TaggerFileRecord] = Field(default_factory=list)
    source: TaggerSourceRecord | None = None
    disk_size: int = 0
    created_at: str
    updated_at: str


class TaggerAdapterSummary(BaseModel):
    id: str
    name: str
    description: str
    contract_version: int = Field(ge=1)


class TaggerRuntimeInfo(BaseModel):
    available: bool
    providers: list[str] = Field(default_factory=list)
    devices: list[TaggerDevice] = Field(default_factory=list)
    error: str | None = None


class TaggerProfile(BaseModel):
    id: str
    name: str
    installation_id: str
    selection: TaggerSelectionPolicy
    categories: list[str]
    device: TaggerDevice = TaggerDevice.AUTO
    concurrency: int = Field(default=1, ge=1, le=8)
    batch_size: int | None = Field(default=None, ge=1, le=32)
    installation_name: str | None = None
    model_version: str | None = None
    ready: bool = False
    issue: str | None = None
    created_at: str
    updated_at: str


class TaggerProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    installation_id: str = Field(min_length=1)
    selection: TaggerSelectionPolicy = Field(default_factory=TaggerSelectionPolicy)
    categories: list[str] = Field(default_factory=list, max_length=32)
    device: TaggerDevice = TaggerDevice.AUTO
    concurrency: int = Field(default=1, ge=1, le=8)
    batch_size: int | None = Field(default=None, ge=1, le=32)

    _validate_name = field_validator("name")(_non_blank)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_threshold(cls, value: object) -> object:
        if not isinstance(value, dict) or "selection" in value or "threshold" not in value:
            return value
        upgraded = dict(value)
        upgraded["selection"] = {
            "mode": TaggerSelectionMode.GLOBAL,
            "global_threshold": upgraded.pop("threshold"),
        }
        return upgraded

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
    selection: TaggerSelectionPolicy | None = None
    categories: list[str] | None = Field(default=None, max_length=32)
    device: TaggerDevice | None = None
    concurrency: int | None = Field(default=None, ge=1, le=8)
    batch_size: int | None = Field(default=None, ge=1, le=32)

    _validate_name = field_validator("name")(_non_blank)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_threshold(cls, value: object) -> object:
        if not isinstance(value, dict) or "selection" in value or "threshold" not in value:
            return value
        upgraded = dict(value)
        upgraded["selection"] = {
            "mode": TaggerSelectionMode.GLOBAL,
            "global_threshold": upgraded.pop("threshold"),
        }
        return upgraded

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
    snapshot_version: Literal[1, 2, 3] = 3
    backend: Literal["local_tagger"] = "local_tagger"
    id: str
    name: str
    installation_id: str
    installation_name: str
    adapter_id: str
    adapter_contract_version: int = Field(default=1, ge=1)
    model_version: str
    fingerprint: str
    selection: TaggerSelectionPolicy
    categories: list[str]
    device: TaggerDevice
    concurrency: int = Field(ge=1, le=8)
    batch_size: int | None = Field(default=None, ge=1, le=32)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_snapshot(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        upgraded = dict(value)
        if int(upgraded.get("snapshot_version") or 1) == 1 and "batch_size" not in upgraded:
            # v1 used independent one-image workers. Reusing that value as the
            # requested inference batch preserves the user's throughput intent;
            # adapters and the runtime still clamp or split unsafe batches.
            upgraded["batch_size"] = int(upgraded.get("concurrency") or 1)
        if "selection" not in upgraded:
            upgraded["selection"] = {
                "mode": TaggerSelectionMode.GLOBAL,
                "global_threshold": upgraded.pop("threshold", 0.55),
            }
        return upgraded

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


class TaggerVocabularyItem(BaseModel):
    name: str
    category: str


class TaggerVocabularySearchResult(BaseModel):
    installation_id: str
    installation_name: str
    fingerprint: str
    query: str
    category: str | None = None
    items: list[TaggerVocabularyItem] = Field(default_factory=list)


class TaggerInferenceTag(BaseModel):
    name: str
    category: str
    confidence: float


class TaggerInferenceResult(BaseModel):
    content: str
    tags: list[TaggerInferenceTag]
    provider: str
    inference_ms: float
    batch_size: int = Field(default=1, ge=1)
    batch_inference_ms: float | None = Field(default=None, ge=0)
