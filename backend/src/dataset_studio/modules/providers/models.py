from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class MultimodalRequest:
    image_path: Path
    system_prompt: str
    user_prompt: str
    model: str
    temperature: float
    max_output_tokens: int
    timeout_seconds: int


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    content: str
    raw_payload: dict[str, object]
    finish_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


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
