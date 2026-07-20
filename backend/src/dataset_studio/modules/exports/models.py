from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: ExportScope = ExportScope.ALL
    asset_ids: list[str] = Field(default_factory=list)
    destination_path: str = Field(min_length=1, max_length=32_767)

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

    @model_validator(mode="after")
    def validate_scope(self):
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
    valid_count: int
    manually_accepted_count: int
    missing_count: int
    empty_count: int
    invalid_count: int
    encoding_error_count: int
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
