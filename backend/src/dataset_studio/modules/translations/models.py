from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class TranslationStatus(StrEnum):
    MISSING = "missing"
    CURRENT = "current"
    STALE = "stale"
    UNTRACKED = "untracked"
    SOURCE_MISSING = "source_missing"
    SOURCE_INVALID = "source_invalid"
    CONFLICT = "conflict"


class TranslationDocument(BaseModel):
    asset_id: str
    language: str
    path: str
    exists: bool
    content: str = ""
    status: TranslationStatus
    source_exists: bool
    source_hash: str | None = None
    current_source_hash: str | None = None
    validation_status: str | None = None
    provider_profile_id: str | None = None
    provider_profile_name: str | None = None
    model: str | None = None
    modified_at: str | None = None
    updated_at: str | None = None
    issue: str | None = None


class TranslationList(BaseModel):
    items: list[TranslationDocument] = Field(default_factory=list)
