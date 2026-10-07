from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from dataset_studio.modules.cropping.models import CropRect, Ratio


class CropSourceSelection(BaseModel):
    asset_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_assets(self) -> CropSourceSelection:
        if len(self.asset_ids) != len(set(self.asset_ids)):
            raise ValueError("裁剪素材列表包含重复 ID。")
        return self


class CropSource(BaseModel):
    id: str
    relative_path: str
    filename: str
    width: int
    height: int
    content_version: str


class CropSourceRegions(BaseModel):
    asset_id: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    rectangles: list[CropRect] = Field(min_length=1)


class MultiCropRequest(BaseModel):
    items: list[CropSourceRegions] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_sources(self) -> MultiCropRequest:
        ids = [item.asset_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("多图裁剪包含重复源图；请将同一源图的区域合并。")
        return self


class PositionedBatchCropRequest(MultiCropRequest):
    ratio: Ratio

    @model_validator(mode="after")
    def require_one_rectangle(self) -> PositionedBatchCropRequest:
        if any(len(item.rectangles) != 1 for item in self.items):
            raise ValueError("批量裁剪每张源图必须且只能包含一个裁剪框。")
        return self


class StoredMultiCrop(BaseModel):
    kind: Literal["multi"]
    request: MultiCropRequest


class StoredPositionedBatchCrop(BaseModel):
    kind: Literal["positioned_batch"]
    request: PositionedBatchCropRequest
