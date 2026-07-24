from __future__ import annotations

from enum import StrEnum
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator


class TaggerDownloadStatus(StrEnum):
    QUEUED = "queued"
    RESOLVING = "resolving"
    DOWNLOADING = "downloading"
    VERIFYING = "verifying"
    INSTALLING = "installing"
    COMPLETED = "completed"
    PAUSED = "paused"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


ACTIVE_DOWNLOAD_STATUSES = frozenset(
    {
        TaggerDownloadStatus.QUEUED,
        TaggerDownloadStatus.RESOLVING,
        TaggerDownloadStatus.DOWNLOADING,
        TaggerDownloadStatus.VERIFYING,
        TaggerDownloadStatus.INSTALLING,
    }
)
RESUMABLE_DOWNLOAD_STATUSES = frozenset(
    {
        TaggerDownloadStatus.PAUSED,
        TaggerDownloadStatus.FAILED,
        TaggerDownloadStatus.INTERRUPTED,
    }
)


class HuggingFaceProxyMode(StrEnum):
    ENVIRONMENT = "environment"
    CUSTOM = "custom"
    DIRECT = "direct"


class TaggerDownloadCreate(BaseModel):
    plan_id: str = Field(min_length=3, max_length=120)
    license_accepted: bool = False


class TaggerDownloadOffer(BaseModel):
    plan_id: str
    adapter_id: str
    adapter_name: str
    name: str
    model_version: str
    description: str
    repo_id: str
    revision: str
    source_url: str
    license_id: str
    license_url: str
    gated: bool
    provenance: Literal["author", "community"]
    download_size: int = Field(ge=1)
    file_count: int = Field(ge=1)
    installed_installation_id: str | None = None
    installed_installation_name: str | None = None
    active_download_id: str | None = None


class TaggerDownloadTask(BaseModel):
    id: str
    plan_id: str
    plan_name: str
    adapter_id: str
    repo_id: str
    revision: str
    model_root: str
    status: TaggerDownloadStatus
    bytes_total: int = Field(ge=1)
    bytes_downloaded: int = Field(ge=0)
    files_total: int = Field(ge=1)
    files_completed: int = Field(ge=0)
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


class HuggingFaceConnectionSettings(BaseModel):
    token_source: Literal["app", "environment", "local_login", "anonymous"]
    has_saved_token: bool
    proxy_mode: HuggingFaceProxyMode
    has_custom_proxy: bool
    proxy_display: str | None = None
    credential_store_available: bool = True
    credential_store_error: str | None = None


class HuggingFaceSettingsUpdate(BaseModel):
    proxy_mode: HuggingFaceProxyMode
    token: str | None = Field(default=None, max_length=512)
    clear_token: bool = False
    proxy_url: str | None = Field(default=None, max_length=2048)
    clear_proxy: bool = False

    @field_validator("token")
    @classmethod
    def normalize_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Hugging Face Token 不能为空。")
        if not normalized.startswith("hf_"):
            raise ValueError("Hugging Face Token 格式无效。")
        return normalized

    @field_validator("proxy_url")
    @classmethod
    def normalize_proxy_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        try:
            parsed = urlsplit(normalized)
            _ = parsed.port
        except ValueError:
            raise ValueError("自定义代理必须是有效的 HTTP 或 HTTPS 地址。") from None
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("自定义代理必须是有效的 HTTP 或 HTTPS 地址。")
        return normalized

    @model_validator(mode="after")
    def validate_changes(self) -> HuggingFaceSettingsUpdate:
        if self.clear_token and self.token is not None:
            raise ValueError("不能同时保存并清除 Hugging Face Token。")
        if self.clear_proxy and self.proxy_url is not None:
            raise ValueError("不能同时保存并清除自定义代理。")
        return self


class HuggingFaceConnectionTest(BaseModel):
    connected: bool
    username: str | None = None
    token_source: Literal["app", "environment", "local_login", "anonymous"]
    proxy_mode: HuggingFaceProxyMode
    proxy_display: str | None = None
    latency_ms: int = Field(ge=0)
    message: str


class TaggerDownloadCenter(BaseModel):
    offers: list[TaggerDownloadOffer]
    tasks: list[TaggerDownloadTask]
