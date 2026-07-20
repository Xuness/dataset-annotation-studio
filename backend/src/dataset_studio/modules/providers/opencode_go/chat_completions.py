from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import ProviderProfile
from dataset_studio.modules.providers.media import image_data_url
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.providers.opencode_go.model_specs import OpenCodeGoModelSpec
from dataset_studio.modules.providers.reasoning import extract_chat_message_reasoning


def build_payload(
    spec: OpenCodeGoModelSpec,
    profile: ProviderProfile,
    request: MultimodalRequest,
) -> dict[str, object]:
    user_content: list[dict[str, object]] = [{"type": "text", "text": request.user_prompt}]
    if request.image_path is not None:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": image_data_url(request.image_path)},
            }
        )
    payload: dict[str, object] = {
        "model": request.model,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {
                "role": "user",
                "content": user_content,
            },
        ],
        "max_tokens": request.max_output_tokens,
    }
    if spec.supports_temperature:
        payload["temperature"] = request.temperature
    effort = profile.request_options.reasoning_effort
    if effort is not None:
        payload["reasoning_effort"] = effort.value
    return payload


def parse_response(raw: object, response_text: str) -> ProviderResponse:
    if not isinstance(raw, dict):
        raise ProviderRequestError(
            "OpenCode Go Chat Completions 响应结构无法识别。",
            response_text=response_text,
        )
    _raise_payload_error(raw, response_text)
    try:
        choices = raw["choices"]
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise TypeError("choices is invalid")
        choice = choices[0]
        message = choice["message"]
        if not isinstance(message, dict):
            raise TypeError("message is invalid")
        usage = raw.get("usage")
        usage = usage if isinstance(usage, dict) else {}
        prompt_details = usage.get("prompt_tokens_details")
        prompt_details = prompt_details if isinstance(prompt_details, dict) else {}
        completion_details = usage.get("completion_tokens_details")
        completion_details = completion_details if isinstance(completion_details, dict) else {}
        return ProviderResponse(
            content=_extract_content(message.get("content")),
            raw_payload=raw,
            reasoning_content=extract_chat_message_reasoning(message),
            finish_reason=_optional_string(choice.get("finish_reason")),
            input_tokens=_optional_int(usage.get("prompt_tokens")),
            output_tokens=_optional_int(usage.get("completion_tokens")),
            cache_read_tokens=_optional_int(prompt_details.get("cached_tokens")),
            reasoning_tokens=_optional_int(completion_details.get("reasoning_tokens")),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderRequestError(
            "OpenCode Go Chat Completions 响应结构无法识别。",
            response_text=response_text,
        ) from error


async def complete(
    spec: OpenCodeGoModelSpec,
    profile: ProviderProfile,
    credential: str,
    request: MultimodalRequest,
) -> ProviderResponse:
    url = f"{profile.base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {credential}",
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
        raise ProviderRequestError(f"OpenCode Go Chat Completions 请求失败：{error}") from error
    if not response.is_success:
        raise ProviderRequestError(
            f"OpenCode Go Chat Completions 返回 HTTP {response.status_code}",
            status_code=response.status_code,
            response_text=response.text,
        )
    try:
        raw = response.json()
    except ValueError as error:
        raise ProviderRequestError(
            "OpenCode Go Chat Completions 响应结构无法识别。",
            response_text=response.text,
        ) from error
    return parse_response(raw, response.text)


def _extract_content(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(
            str(part.get("text", ""))
            for part in value
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return ""


def _raise_payload_error(raw: dict[str, object], response_text: str) -> None:
    error = raw.get("error")
    if error is None:
        return
    if isinstance(error, dict):
        message = error.get("message") or error.get("detail") or "未知 API 错误"
        status_code = _optional_int(error.get("status_code") or error.get("status"))
    else:
        message = error
        status_code = None
    raise ProviderRequestError(
        f"OpenCode Go API 返回错误：{message}",
        status_code=status_code,
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
