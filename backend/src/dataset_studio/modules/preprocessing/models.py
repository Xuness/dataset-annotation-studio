from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class OutputFormat(StrEnum):
    WEBP = "webp"
    JPEG = "jpeg"
    PNG = "png"


class ResizeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_edge: int = Field(ge=64, le=65_536)
    allow_upscale: bool = False


class ConvertOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: OutputFormat
    quality: int = Field(default=90, ge=1, le=100)
    effort: int = Field(default=4, ge=0, le=6)


class PreprocessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str] = Field(default_factory=list)
    resize: ResizeOptions | None = None
    convert: ConvertOptions | None = None

    @model_validator(mode="after")
    def require_an_operation(self):
        if self.resize is None and self.convert is None:
            raise ValueError("至少需要启用缩放或格式转换。")
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


class PreprocessExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: PreprocessRequest
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")


class PreprocessOperation(BaseModel):
    id: str
    status: str
    item_count: int
    options: PreprocessRequest
    created_at: str
    completed_at: str | None = None
    undone_at: str | None = None
    error_message: str | None = None
