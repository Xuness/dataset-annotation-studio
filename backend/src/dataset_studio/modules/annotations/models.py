from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AnnotationStatus(StrEnum):
    MISSING = "missing"
    VALID = "valid"
    INVALID = "invalid"
    ENCODING_ERROR = "encoding_error"
    EMPTY = "empty"
    UNCHECKED = "unchecked"
    MANUALLY_ACCEPTED = "manually_accepted"


class ValidationIssue(BaseModel):
    code: str
    message: str
    offset: int | None = None
    tag: str | None = None


class ValidationResult(BaseModel):
    valid: bool
    status: AnnotationStatus
    tag_count: int = 0
    issues: list[ValidationIssue] = Field(default_factory=list)


class AnnotationDocument(BaseModel):
    asset_id: str
    path: str
    exists: bool
    content: str = ""
    status: AnnotationStatus
    validation: ValidationResult | None = None
    modified_at: str | None = None


class AnnotationUpdate(BaseModel):
    content: str


class AnnotationBatchDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str]

    @field_validator("asset_ids")
    @classmethod
    def normalize_asset_ids(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(asset_id for asset_id in value if asset_id))
        if not normalized:
            raise ValueError("至少需要选择一个素材。")
        return normalized


class AnnotationBatchDeleteResult(BaseModel):
    requested_count: int
    deleted_count: int
    missing_count: int
    asset_ids: list[str]


class AnnotationRevision(BaseModel):
    id: str
    source: str
    validation_status: AnnotationStatus
    created_at: str
    content: str
