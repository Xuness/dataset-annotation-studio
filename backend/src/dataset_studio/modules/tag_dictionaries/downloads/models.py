from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryDownloadMode,
    TagDictionaryLicenseStatus,
)


class TagDictionaryDownloadStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    VERIFYING = "verifying"
    INSTALLING = "installing"
    COMPLETED = "completed"
    PAUSED = "paused"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


ACTIVE_DICTIONARY_DOWNLOAD_STATUSES = frozenset(
    {
        TagDictionaryDownloadStatus.QUEUED,
        TagDictionaryDownloadStatus.DOWNLOADING,
        TagDictionaryDownloadStatus.VERIFYING,
        TagDictionaryDownloadStatus.INSTALLING,
    }
)
RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES = frozenset(
    {
        TagDictionaryDownloadStatus.PAUSED,
        TagDictionaryDownloadStatus.FAILED,
        TagDictionaryDownloadStatus.INTERRUPTED,
    }
)


class TagDictionaryDownloadOffer(BaseModel):
    offer_id: str
    adapter_id: str
    name: str
    description: str
    source_id: str
    source_url: str
    source_version: str
    revision: str | None = None
    download_mode: TagDictionaryDownloadMode
    download_url: str | None = None
    filename: str | None = None
    download_size: int | None = Field(default=None, ge=1)
    sha256: str | None = Field(default=None, min_length=64, max_length=64)
    license_id: str
    license_url: str
    license_status: TagDictionaryLicenseStatus
    license_notice: str
    installed_installation_id: str | None = None
    active_download_id: str | None = None


class TagDictionaryDownloadCreate(BaseModel):
    offer_id: str = Field(min_length=3, max_length=160)
    license_accepted: bool = False


class TagDictionaryDownloadTask(BaseModel):
    id: str
    offer_id: str
    offer_name: str
    adapter_id: str
    source_id: str
    source_version: str
    revision: str | None = None
    dictionary_root: str
    status: TagDictionaryDownloadStatus
    bytes_total: int = Field(ge=1)
    bytes_downloaded: int = Field(ge=0)
    current_file: str | None = None
    speed_bps: float | None = Field(default=None, ge=0)
    eta_seconds: int | None = Field(default=None, ge=0)
    stop_requested: bool = False
    installation_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    can_pause: bool = False
    can_resume: bool = False
    can_delete: bool = False
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    updated_at: str


class TagDictionaryDownloadCenter(BaseModel):
    offers: list[TagDictionaryDownloadOffer]
    tasks: list[TagDictionaryDownloadTask]
