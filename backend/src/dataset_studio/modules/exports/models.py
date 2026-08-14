from __future__ import annotations

from enum import StrEnum
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.core.languages import normalize_language_code
from dataset_studio.modules.annotations.models import AnnotationChannel
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    DEFAULT_TRANSLATION_SOURCE_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
)


class ExportScope(StrEnum):
    ALL = "all"
    SELECTED = "selected"


class ExportOperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    INTERRUPTED = "interrupted"
    COMPLETED = "completed"
    FAILED = "failed"


class ExportRevisionMode(StrEnum):
    CURRENT = "current"
    REVIEWED = "reviewed"


class ExportFormat(StrEnum):
    TXT = "txt"
    JSON = "json"


class ExportPackaging(StrEnum):
    DIRECTORY = "directory"
    ZIP = "zip"


class ExportDirectoryMode(StrEnum):
    FLAT = "flat"
    PRESERVE = "preserve"
    CUSTOM = "custom"


class ExportDirectoryLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: ExportDirectoryMode = ExportDirectoryMode.FLAT
    merge_into_parent_paths: list[str] = Field(default_factory=list, max_length=10_000)

    @field_validator("merge_into_parent_paths")
    @classmethod
    def normalize_merge_paths(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_path in value:
            candidate = raw_path.strip()
            parts = candidate.split("/")
            pure = PurePosixPath(candidate)
            if (
                not candidate
                or pure.is_absolute()
                or "\\" in candidate
                or "\x00" in candidate
                or any(part in {"", ".", ".."} for part in parts)
            ):
                raise ValueError("合并目录必须是工作区内的安全相对路径。")
            path = pure.as_posix()
            key = path.casefold()
            if key not in seen:
                seen.add(key)
                normalized.append(path)
        return normalized

    @model_validator(mode="after")
    def validate_mode(self) -> ExportDirectoryLayout:
        if self.mode != ExportDirectoryMode.CUSTOM and self.merge_into_parent_paths:
            raise ValueError("只有自定义目录模式可以指定并入父级的目录。")
        return self


class ExportChannelSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: AnnotationChannel
    language: str = ""
    translation_source_kind: TranslationSourceKind | None = None
    translation_producer_kind: TranslationProducerKind | None = None
    revision: ExportRevisionMode = ExportRevisionMode.CURRENT

    @field_validator("revision", mode="before")
    @classmethod
    def normalize_legacy_revision_mode(cls, value: object) -> object:
        if value == "head":
            return ExportRevisionMode.CURRENT
        if value == "confirmed":
            return ExportRevisionMode.REVIEWED
        return value

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        if not value.strip():
            return ""
        try:
            return normalize_language_code(value)
        except ValueError as error:
            raise ValueError("导出翻译通道的语言代码无效。") from error

    @model_validator(mode="after")
    def validate_language(self) -> ExportChannelSelection:
        if self.channel == AnnotationChannel.TRANSLATION and not self.language:
            raise ValueError("导出翻译通道时必须指定语言。")
        if self.channel == AnnotationChannel.TRANSLATION:
            self.translation_source_kind = (
                self.translation_source_kind or DEFAULT_TRANSLATION_SOURCE_KIND
            )
            self.translation_producer_kind = (
                self.translation_producer_kind or DEFAULT_TRANSLATION_PRODUCER_KIND
            )
        elif (
            self.language
            or self.translation_source_kind is not None
            or self.translation_producer_kind is not None
        ):
            raise ValueError("只有翻译通道可以指定译文身份。")
        return self

    @property
    def key(self) -> str:
        if self.channel != AnnotationChannel.TRANSLATION:
            return self.channel.value
        assert self.translation_source_kind is not None
        assert self.translation_producer_kind is not None
        return (
            f"{self.channel.value}:{self.translation_source_kind.value}:"
            f"{self.translation_producer_kind.value}:{self.language}"
        )


def _default_channels() -> list[ExportChannelSelection]:
    return [
        ExportChannelSelection(
            channel=AnnotationChannel.EXISTING,
            revision=ExportRevisionMode.CURRENT,
        )
    ]


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: ExportScope = ExportScope.ALL
    asset_ids: list[str] = Field(default_factory=list)
    destination_path: str = Field(min_length=1, max_length=32_767)
    channels: list[ExportChannelSelection] = Field(
        default_factory=_default_channels,
        min_length=1,
        max_length=32,
    )
    formats: list[ExportFormat] = Field(
        default_factory=lambda: [ExportFormat.TXT],
        min_length=1,
        max_length=2,
    )
    packaging: ExportPackaging = ExportPackaging.DIRECTORY
    directory_layout: ExportDirectoryLayout = Field(default_factory=ExportDirectoryLayout)

    @field_validator("asset_ids")
    @classmethod
    def normalize_asset_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(asset_id for asset_id in value if asset_id))

    @field_validator("destination_path")
    @classmethod
    def normalize_destination_path(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("请选择导出目录。")
        return normalized

    @field_validator("channels")
    @classmethod
    def unique_channels(
        cls,
        value: list[ExportChannelSelection],
    ) -> list[ExportChannelSelection]:
        keys = [selection.key for selection in value]
        if len(keys) != len(set(keys)):
            raise ValueError("同一个标注通道不能重复选择。")
        return value

    @field_validator("formats")
    @classmethod
    def unique_formats(cls, value: list[ExportFormat]) -> list[ExportFormat]:
        if len(value) != len(set(value)):
            raise ValueError("导出格式不能重复。")
        return value

    @model_validator(mode="after")
    def validate_scope(self) -> ExportRequest:
        if self.scope == ExportScope.SELECTED and not self.asset_ids:
            raise ValueError("请先在素材工作台中选择要导出的图片。")
        if self.scope == ExportScope.ALL and self.asset_ids:
            raise ValueError("导出整个项目时不应携带单独的素材 ID。")
        return self


class ExportPreviewItem(BaseModel):
    asset_id: str
    source_relative_path: str
    target_image_name: str
    target_annotation_name: str
    target_outputs: list[str] = Field(default_factory=list)
    channel_statuses: dict[str, str] = Field(default_factory=dict)
    annotation_status: str
    image_bytes: int
    annotation_bytes: int
    warning_code: str | None = None
    warning_message: str | None = None
    blocking_issue: str | None = None


class ExportPreview(BaseModel):
    items: list[ExportPreviewItem]
    total_items: int
    truncated: bool = False
    image_bytes: int
    annotation_bytes: int
    usable_count: int
    reviewed_count: int
    missing_count: int
    empty_count: int
    invalid_count: int
    encoding_error_count: int
    unreviewed_count: int = 0
    stale_count: int = 0
    warning_count: int
    blocking_issue_count: int
    blocking_issues: list[str] = Field(default_factory=list)
    preview_token: str


class ExportCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: ExportRequest
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    allow_warnings: bool = False


class ExportOperation(BaseModel):
    id: str
    status: ExportOperationStatus
    scope: ExportScope
    destination_path: str
    total_items: int
    completed_items: int
    total_bytes: int
    copied_bytes: int
    warning_count: int
    allow_warnings: bool
    configuration_snapshot: dict[str, object] = Field(default_factory=dict)
    current_relative_path: str | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error_message: str | None = None

    @property
    def active(self) -> bool:
        return self.status in {
            ExportOperationStatus.QUEUED,
            ExportOperationStatus.RUNNING,
            ExportOperationStatus.STOPPING,
        }


ExportIssueLevel = Literal["warning", "error"]
