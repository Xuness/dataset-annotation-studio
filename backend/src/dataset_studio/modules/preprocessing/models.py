from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class OutputFormat(StrEnum):
    WEBP = "webp"
    JPEG = "jpeg"
    PNG = "png"


class PreprocessExecutionMode(StrEnum):
    AUTO = "auto"
    CPU_ONLY = "cpu_only"
    PREFER_ACCELERATOR = "prefer_accelerator"


class PreprocessRoute(StrEnum):
    CPU = "cpu"
    ACCELERATED_FULL = "accelerated_full"
    ACCELERATED_RESIZE = "accelerated_resize"


class ResizeAlgorithm(StrEnum):
    LANCZOS3 = "lanczos3"
    LANCZOS4 = "lanczos4"
    ANIME_LOW_HALO = "anime_low_halo"


class PreprocessItemPhase(StrEnum):
    PREPARED = "prepared"
    COMMITTING = "committing"
    COMMITTED = "committed"


class ResizeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_edge: int = Field(ge=64, le=65_536)
    allow_upscale: bool = False
    algorithm: ResizeAlgorithm = ResizeAlgorithm.LANCZOS3


class ConvertOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: OutputFormat
    quality: int = Field(default=90, ge=1, le=100)
    effort: int = Field(default=4, ge=0, le=6)


class RenameOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template: str = Field(min_length=1, max_length=200)
    start_index: int = Field(default=1, ge=0, le=9_999_999_999)
    padding: int = Field(default=6, ge=1, le=12)

    @field_validator("template")
    @classmethod
    def validate_template_fields(cls, value: str) -> str:
        remainder = value.replace("{name}", "").replace("{index}", "")
        if "{" in remainder or "}" in remainder:
            raise ValueError("重命名模板仅支持 {name} 和 {index} 占位符。")
        return value


class PreprocessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str] = Field(default_factory=list)
    resize: ResizeOptions | None = None
    convert: ConvertOptions | None = None
    rename: RenameOptions | None = None

    @model_validator(mode="after")
    def require_an_operation(self):
        if self.resize is None and self.convert is None and self.rename is None:
            raise ValueError("至少需要启用缩放、格式转换或批量重命名。")
        return self


class PreprocessPreviewItem(BaseModel):
    asset_id: str
    before_relative_path: str
    after_relative_path: str
    before_width: int
    before_height: int
    after_width: int
    after_height: int
    will_change: bool
    warning: str | None = None


class PreprocessPreview(BaseModel):
    items: list[PreprocessPreviewItem]
    total_items: int
    truncated: bool = False
    changed_count: int
    unchanged_count: int
    warning_count: int
    preview_token: str


class PreprocessExecutionOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: PreprocessExecutionMode = PreprocessExecutionMode.CPU_ONLY
    accelerator_id: str | None = Field(default=None, min_length=1, max_length=200)
    max_workers: int | None = Field(default=None, ge=1, le=16)
    batch_size: int | None = Field(default=None, ge=1, le=256)


class ImageProcessingBackend(BaseModel):
    id: str
    kind: str
    label: str
    status: Literal["ready", "degraded", "unavailable"]
    device_name: str | None = None
    total_memory_bytes: int | None = Field(default=None, ge=0)
    supports_batch: bool = False
    decode_formats: list[str] = Field(default_factory=list)
    encode_formats: list[str] = Field(default_factory=list)
    resize_algorithms: list[ResizeAlgorithm] = Field(default_factory=list)
    issue: str | None = None


class ImageProcessingBackends(BaseModel):
    revision: str
    backends: list[ImageProcessingBackend]


class PreprocessExecutionPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: PreprocessRequest
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    execution: PreprocessExecutionOptions = Field(default_factory=PreprocessExecutionOptions)


class PreprocessExecutionPlanItem(BaseModel):
    asset_id: str
    route: PreprocessRoute
    backend_id: str
    reason_code: str | None = None


class PreprocessExecutionPlan(BaseModel):
    items: list[PreprocessExecutionPlanItem]
    total_render_items: int
    truncated: bool = False
    selected_backend_id: str
    route_counts: dict[str, int] = Field(default_factory=dict)
    route_reasons: dict[str, int] = Field(default_factory=dict)
    effective_cpu_workers: int = Field(ge=1)
    effective_batch_size: int = Field(ge=1)
    capability_revision: str


class PreprocessExecutionRuntime(BaseModel):
    requested_mode: PreprocessExecutionMode
    selected_backend_id: str
    backend_label: str
    route_counts: dict[str, int] = Field(default_factory=dict)
    route_reason_counts: dict[str, int] = Field(default_factory=dict)
    fallback_counts: dict[str, int] = Field(default_factory=dict)
    worker_count: int = Field(ge=1)
    batch_size: int = Field(ge=1)
    duration_ms: int = Field(ge=0)


class PreprocessExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: PreprocessRequest
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    execution: PreprocessExecutionOptions = Field(default_factory=PreprocessExecutionOptions)


class PreprocessOperation(BaseModel):
    id: str
    status: str
    item_count: int
    completed_items: int = Field(default=0, ge=0)
    eta_seconds: int | None = Field(default=None, ge=0)
    current_relative_path: str | None = None
    options: PreprocessRequest
    execution: PreprocessExecutionOptions = Field(default_factory=PreprocessExecutionOptions)
    created_at: str
    completed_at: str | None = None
    undone_at: str | None = None
    error_message: str | None = None
    runtime: PreprocessExecutionRuntime | None = None
