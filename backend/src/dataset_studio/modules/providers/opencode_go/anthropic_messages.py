from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import (
    ProviderProfile,
    ReasoningEffort,
)
from dataset_studio.modules.providers.media import encode_image_base64, image_mime_type
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.providers.opencode_go.model_specs import OpenCodeGoModelSpec
from dataset_studio.modules.providers.reasoning import extract_anthropic_reasoning


def reasoning_budget(
    spec: OpenCodeGoModelSpec,
    effort: ReasoningEffort | None,
    max_output_tokens: int,
) -> int | None:
    if effort is None:
        return None
    if spec.max_reasoning_budget is None:
        raise ProviderRequestError(f"OpenCode Go 模型 {spec.id} 不支持预算式推理。")
    available = min(spec.max_reasoning_budget, max_output_tokens - 1)
    if available < 1024:
        raise ProviderRequestError(
            "Anthropic Messages 的推理预算至少需要 1024 Token；请将最大输出长度提高到 1025 或以上。"
        )
    if effort == ReasoningEffort.HIGH:
        return max(1024, available // 2)
    if effort == ReasoningEffort.MAX:
        return available
    raise ProviderRequestError(f"OpenCode Go 模型 {spec.id} 不支持推理强度 {effort.value}。")


def build_payload(
    spec: OpenCodeGoModelSpec,
    profile: ProviderProfile,
    request: MultimodalRequest,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": request.model,
        "max_tokens": request.max_output_tokens,
        "system": [
            {
                "type": "text",
                "text": request.system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": request.user_prompt},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image_mime_type(request.image_path),
                            "data": encode_image_base64(request.image_path),
                        },
                    },
                ],
            }
        ],
    }
    budget = reasoning_budget(
        spec,
        profile.request_options.reasoning_effort,
        request.max_output_tokens,
    )
    if budget is not None:
        payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
    elif spec.supports_temperature:
        payload["temperature"] = request.temperature
    return payload


def parse_response(raw: object, response_text: str) -> ProviderResponse:
    if not isinstance(raw, dict):
        raise ProviderRequestError(
            "OpenCode Go Anthropic Messages 响应结构无法识别。",
            response_text=response_text,
        )
    _raise_payload_error(raw, response_text)
    try:
        blocks = raw["content"]
        if not isinstance(blocks, list):
            raise TypeError("content is not a list")
        usage = raw.get("usage")
        usage = usage if isinstance(usage, dict) else {}
        content = "".join(
            str(block.get("text", ""))
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        )
        return ProviderResponse(
            content=content,
            raw_payload=raw,
            reasoning_content=extract_anthropic_reasoning(blocks),
            finish_reason=_optional_string(raw.get("stop_reason")),
            input_tokens=_optional_int(usage.get("input_tokens")),
            output_tokens=_optional_int(usage.get("output_tokens")),
            cache_read_tokens=_optional_int(usage.get("cache_read_input_tokens")),
            cache_write_tokens=_optional_int(usage.get("cache_creation_input_tokens")),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderRequestError(
            "OpenCode Go Anthropic Messages 响应结构无法识别。",
            response_text=response_text,
        ) from error


async def complete(
    spec: OpenCodeGoModelSpec,
    profile: ProviderProfile,
    credential: str,
    request: MultimodalRequest,
) -> ProviderResponse:
    url = f"{profile.base_url.rstrip('/')}/messages"
    headers = {
        "x-api-key": credential,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=request.timeout_seconds) as client:
            response = await client.post(
                url,
                headers=headers,
                json=build_payload(spec, profile, request),
            )
    except httpx.HTTPError as error:
        raise ProviderRequestError(f"OpenCode Go Anthropic Messages 请求失败：{error}") from error
    if not response.is_success:
        raise ProviderRequestError(
            f"OpenCode Go Anthropic Messages 返回 HTTP {response.status_code}",
            status_code=response.status_code,
            response_text=response.text,
        )
    try:
        raw = response.json()
    except ValueError as error:
        raise ProviderRequestError(
            "OpenCode Go Anthropic Messages 响应结构无法识别。",
            response_text=response.text,
        ) from error
    return parse_response(raw, response.text)


def _raise_payload_error(raw: dict[str, object], response_text: str) -> None:
    error = raw.get("error")
    if error is None:
        return
    if isinstance(error, dict):
        message = error.get("message") or error.get("detail") or "未知 API 错误"
    else:
        message = error
    raise ProviderRequestError(
        f"OpenCode Go API 返回错误：{message}",
        response_text=response_text,
    )


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_string(value: object) -> str | None:
    return str(value) if value is not None else None
