from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class AnnotationStatus(StrEnum):
    MISSING = "missing"
    VALID = "valid"
    INVALID = "invalid"
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


class AnnotationRevision(BaseModel):
    id: str
    source: str
    validation_status: AnnotationStatus
    created_at: str
    content: str
