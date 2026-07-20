from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field


@dataclass(frozen=True, slots=True)
class MultimodalRequest:
    image_path: Path | None
    system_prompt: str
    user_prompt: str


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    content: str
    raw_payload: dict[str, object]
    reasoning_content: str | None = None
    finish_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None


class ProviderModelSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    context_length: int | None = None
    max_output_tokens: int | None = None
    input_modalities: list[str] = Field(default_factory=list)
    supported_parameters: list[str] = Field(default_factory=list)
    reasoning_efforts: list[str] = Field(default_factory=list)
    prompt_price: str | None = None
    completion_price: str | None = None
    capabilities_known: bool = False


class ProviderRequestError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        response_text: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text
