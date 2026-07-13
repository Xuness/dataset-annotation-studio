from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

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


class AssetListResponse(BaseModel):
    items: list[AssetSummary]
    total: int
    offset: int
    limit: int
    status_counts: dict[str, int] = Field(default_factory=dict)


class AssetIdListResponse(BaseModel):
    ids: list[str]
    total: int


class MetadataDocument(BaseModel):
    exists: bool
    path: str | None = None
    value: object | None = None
    fields: list[str] = Field(default_factory=list)
    error: str | None = None
