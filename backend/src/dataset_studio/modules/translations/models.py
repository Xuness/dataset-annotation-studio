from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.translations.identity import (
    TranslationProducerKind,
    TranslationSourceKind,
)


class TranslationStatus(StrEnum):
    MISSING = "missing"
    CURRENT = "current"
    SOURCE_MISMATCH = "source_mismatch"
    INVALID = "invalid"
    SOURCE_MISSING = "source_missing"
    SOURCE_INVALID = "source_invalid"


class TranslationAlignmentStatus(StrEnum):
    ALIGNED = "aligned"
    UNAVAILABLE = "unavailable"
    INVALID = "invalid"


class TranslationAlignmentPart(BaseModel):
    id: str
    kind: str
    source_text: str
    translated_text: str
    category: str | None = None
    confidence: float | None = None


class TranslationDocument(BaseModel):
    asset_id: str
    language: str
    source_kind: TranslationSourceKind
    producer_kind: TranslationProducerKind
    resolved_source_channel: str | None = None
    path: str
    exists: bool
    content: str = ""
    source_content: str = ""
    source_tags: list[AnnotationTag] = Field(default_factory=list)
    status: TranslationStatus
    source_exists: bool
    source_hash: str | None = None
    current_source_hash: str | None = None
    source_revision_id: str | None = None
    alignment_status: TranslationAlignmentStatus = TranslationAlignmentStatus.UNAVAILABLE
    alignment_parts: list[TranslationAlignmentPart] = Field(default_factory=list)
    validation_status: str | None = None
    provider_profile_id: str | None = None
    provider_profile_name: str | None = None
    model: str | None = None
    modified_at: str | None = None
    updated_at: str | None = None
    issue: str | None = None


class TranslationList(BaseModel):
    items: list[TranslationDocument] = Field(default_factory=list)
