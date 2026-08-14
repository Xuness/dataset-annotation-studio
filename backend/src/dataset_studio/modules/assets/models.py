from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.modules.annotations.models import AnnotationStatus

SUPPORTED_IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"})


@dataclass(frozen=True, slots=True)
class AssetRecord:
    id: str
    relative_path: str
    filename: str
    stem: str
    suffix: str
    content_hash: str
    byte_size: int
    modified_ns: int
    width: int
    height: int
    annotation_relative_path: str
    annotation_status: str
    annotation_modified_ns: int | None
    metadata_relative_path: str | None
    image_metadata_version: int
    created_at: str
    updated_at: str


class AssetSummary(BaseModel):
    id: str
    relative_path: str
    filename: str
    suffix: str
    content_version: str
    byte_size: int
    width: int
    height: int
    annotation_relative_path: str
    annotation_status: AnnotationStatus
    metadata_relative_path: str | None = None
    is_candidate: bool = False
    generation_status: Literal["failed"] | None = None
    generation_error: str | None = None
    annotation_channels: dict[str, str] = Field(default_factory=dict)


class AssetListResponse(BaseModel):
    items: list[AssetSummary]
    total: int
    offset: int
    limit: int
    status_counts: dict[str, int] = Field(default_factory=dict)


class AssetIdListResponse(BaseModel):
    ids: list[str]
    total: int


class AssetFolderSummary(BaseModel):
    path: str
    parent_path: str | None
    name: str
    direct_asset_count: int
    descendant_asset_count: int


class AssetFolderListResponse(BaseModel):
    items: list[AssetFolderSummary]


class AssetFolderSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str] = Field(min_length=1, max_length=100_000)

    @field_validator("asset_ids")
    @classmethod
    def normalize_asset_ids(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(asset_id.strip() for asset_id in value if asset_id.strip()))
        if not normalized:
            raise ValueError("请先在素材工作台中选择图片。")
        return normalized


class CandidateScope(StrEnum):
    AUTO = "auto"
    CANDIDATES = "candidates"
    ALL = "all"


class CandidateUpdateAction(StrEnum):
    ADD = "add"
    REMOVE = "remove"
    REPLACE = "replace"
    CLEAR = "clear"


class CandidateSourceKind(StrEnum):
    MANUAL = "manual"
    SCREENING = "screening"


class CandidateSetSummary(BaseModel):
    total_assets: int = Field(ge=0)
    candidate_count: int = Field(ge=0)
    effective_count: int = Field(ge=0)
    active: bool


class CandidateUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: CandidateUpdateAction
    asset_ids: list[str] = Field(default_factory=list, max_length=100_000)
    source_kind: CandidateSourceKind = CandidateSourceKind.MANUAL
    source_operation_id: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("asset_ids")
    @classmethod
    def normalize_asset_ids(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(asset_id.strip() for asset_id in value if asset_id.strip()))
        if len(normalized) != len(value):
            raise ValueError("候选图片 ID 不能为空或重复。")
        return normalized

    @model_validator(mode="after")
    def validate_action(self):
        if self.action == CandidateUpdateAction.CLEAR:
            if self.asset_ids:
                raise ValueError("清空候选集时不能同时提交图片 ID。")
        elif not self.asset_ids:
            raise ValueError("当前候选集操作至少需要一张图片。")

        records_provenance = self.action in {
            CandidateUpdateAction.ADD,
            CandidateUpdateAction.REPLACE,
        }
        if records_provenance and self.source_kind == CandidateSourceKind.SCREENING:
            if not self.source_operation_id:
                raise ValueError("从筛选结果写入候选集时必须提供筛选任务 ID。")
        elif self.source_kind == CandidateSourceKind.MANUAL and self.source_operation_id:
            raise ValueError("手动候选操作不能关联筛选任务。")
        return self


class MetadataDocument(BaseModel):
    exists: bool
    path: str | None = None
    value: object | None = None
    fields: list[str] = Field(default_factory=list)
    error: str | None = None
