from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TokenizationProfileId(StrEnum):
    KREA2 = "krea2"
    ANIMA = "anima"
    T5 = "t5"


class TokenizationMetricDescriptor(BaseModel):
    id: str
    label: str
    short_label: str


class TokenizationProfile(BaseModel):
    id: TokenizationProfileId
    name: str
    description: str
    metrics: list[TokenizationMetricDescriptor]


class TokenCountItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    text: str = Field(max_length=1_000_000)


class TokenCountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: TokenizationProfileId
    items: list[TokenCountItem] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def validate_unique_item_ids(self) -> TokenCountRequest:
        item_ids = [item.id for item in self.items]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("Token 计数项 ID 不能重复。")
        return self


class TokenMetricCount(BaseModel):
    metric_id: str
    count: int = Field(ge=0)


class TokenCountResult(BaseModel):
    id: str
    metrics: list[TokenMetricCount]


class TokenCountResponse(BaseModel):
    profile: TokenizationProfile
    items: list[TokenCountResult]
