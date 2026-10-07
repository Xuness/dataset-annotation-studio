from __future__ import annotations

from math import isfinite
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Ratio(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    width: float = Field(gt=0)
    height: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_factor(self) -> Ratio:
        factor = self.width / self.height
        if not isfinite(factor) or factor <= 0:
            raise ValueError(
                "比例因子必须是可表示的有限正数；宽/高计算超出浮点范围，"
                f"请调整比例宽高：width={self.width}，height={self.height}。"
            )
        return self


class CropRect(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    ratio: Ratio | None


class CropFilter(BaseModel):
    search: str
    status: str | None
    folder_path: str


class SingleCropRequest(BaseModel):
    asset_id: str = Field(min_length=1)
    rectangles: list[CropRect] = Field(min_length=1)


class CropScopeRequest(BaseModel):
    scope: Literal["selected", "filtered", "folder", "all"]
    asset_ids: list[str]
    filters: CropFilter

    @model_validator(mode="after")
    def validate_scope(self) -> CropScopeRequest:
        if self.scope == "selected" and not self.asset_ids:
            raise ValueError("勾选范围为空；请先勾选图片，不能将空选择解释成全部。")
        if self.scope == "folder" and not self.filters.folder_path:
            raise ValueError("目录范围必须指定工作区内的相对目录。")
        return self


class BatchCropRequest(CropScopeRequest):
    ratio: Ratio


class CropPlanItem(BaseModel):
    source_id: str
    source_path: str
    source_hash: str
    source_width: int
    source_height: int
    output_id: str
    output_path: str
    rectangle: CropRect
    whole_image: bool


class CropPlan(BaseModel):
    id: str
    token: str
    items: list[CropPlanItem]
    total: int
    offset: int
    limit: int


class CropExecutionRequest(BaseModel):
    plan_id: str
    token: str


class CropOperation(BaseModel):
    id: str
    status: Literal["running", "undoing", "succeeded", "failed", "recovery_failed", "undone"]
    total: int
    completed: int
    error: str | None
    created_at: str


class RatioPresetInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    ratio: Ratio

    @model_validator(mode="after")
    def validate_name(self) -> RatioPresetInput:
        if not self.name.strip():
            raise ValueError("比例预设名称不能只有空白。")
        return self


class RatioPreset(RatioPresetInput):
    id: str
    builtin: bool


class StoredSingleCrop(BaseModel):
    kind: Literal["single"]
    request: SingleCropRequest


class StoredBatchCrop(BaseModel):
    kind: Literal["batch"]
    request: BatchCropRequest


class CropProvenance(BaseModel):
    operation_id: str
    item: CropPlanItem
