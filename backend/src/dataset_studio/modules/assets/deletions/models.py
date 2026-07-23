from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AssetDeleteStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    UNDOING = "undoing"
    UNDONE = "undone"
    FAILED = "failed"
    RECOVERING = "recovering"
    RECOVERY_REQUIRED = "recovery_required"


class AssetDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str]

    @field_validator("asset_ids")
    @classmethod
    def normalize_asset_ids(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(asset_id for asset_id in value if asset_id))
        if not normalized:
            raise ValueError("至少需要选择一个素材。")
        return normalized


class AssetDeletionPreview(BaseModel):
    asset_count: int
    file_count: int
    image_count: int
    annotation_count: int
    translation_count: int
    metadata_count: int
    shared_sidecar_count: int
    warnings: list[str] = Field(default_factory=list)
    blocking_issues: list[str] = Field(default_factory=list)
    preview_token: str


class AssetDeletionExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: AssetDeletionRequest
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")


class AssetDeleteOperation(BaseModel):
    id: str
    status: AssetDeleteStatus
    asset_count: int
    file_count: int
    image_count: int
    annotation_count: int
    translation_count: int
    metadata_count: int
    shared_sidecar_count: int
    created_at: str
    updated_at: str
    completed_at: str | None = None
    undone_at: str | None = None
    error_message: str | None = None
