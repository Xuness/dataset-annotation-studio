from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class TranslationDictionarySource(BaseModel):
    installation_id: str
    name: str
    adapter_id: str | None = None
    source_version: str | None = None
    matched_count: int = Field(ge=1)


class LocalDictionaryTranslationRefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_source_revision_id: str = Field(min_length=1)
    expected_translation_revision_id: str | None = None

    @field_validator("expected_source_revision_id", "expected_translation_revision_id")
    @classmethod
    def validate_revision_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("修订 ID 不能为空。")
        return normalized


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
    dictionary_resolution_hash: str | None = None
    current_dictionary_resolution_hash: str | None = None
    dictionary_sources: list[TranslationDictionarySource] = Field(default_factory=list)
    dictionary_override_count: int = Field(default=0, ge=0)
    dictionary_unmatched_count: int = Field(default=0, ge=0)
    modified_at: str | None = None
    updated_at: str | None = None
    issue: str | None = None


class TranslationList(BaseModel):
    items: list[TranslationDocument] = Field(default_factory=list)
