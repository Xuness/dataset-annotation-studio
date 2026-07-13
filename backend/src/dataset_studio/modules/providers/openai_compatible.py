from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import (
    PromptCacheStrategy,
    ProviderProfile,
    ProviderType,
)
from dataset_studio.modules.providers.media import image_data_url
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)


def _extract_content(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        texts = [
            str(part.get("text", ""))
            for part in value
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "".join(texts)
    return ""


def _status_code(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and 100 <= value <= 599:
        return value
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        if 100 <= parsed <= 599:
            return parsed
    return None


def _raise_api_error(raw: dict[str, object], response_text: str) -> None:
    error = raw.get("error")
    if error is None:
        return

    status_code = None
    if isinstance(error, dict):
        message_value = error.get("message") or error.get("detail")
        status_code = _status_code(
            error.get("status_code") or error.get("status") or error.get("code")
        )
    else:
        message_value = error
    message = str(message_value).strip() if message_value is not None else "未知 API 错误"
    raise ProviderRequestError(
        f"API 返回错误：{message}",
        status_code=status_code,
        response_text=response_text,
    )


def _parse_response(raw: object, response_text: str) -> ProviderResponse:
    if not isinstance(raw, dict):
        raise ProviderRequestError("API 响应结构无法识别。", response_text=response_text)
    _raise_api_error(raw, response_text)
    try:
        choice = raw["choices"][0]
        content = _extract_content(choice["message"].get("content"))
        usage = raw.get("usage") or {}
        return ProviderResponse(
            content=content,
            raw_payload=raw,
            finish_reason=choice.get("finish_reason"),
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )
    except (AttributeError, KeyError, IndexError, TypeError, ValueError) as error:
        raise ProviderRequestError("API 响应结构无法识别。", response_text=response_text) from error


def _build_payload(profile: ProviderProfile, request: MultimodalRequest) -> dict[str, object]:
    system_content: object = request.system_prompt
    options = profile.request_options
    if (
        profile.provider_type == ProviderType.OPENROUTER
        and options.prompt_cache_strategy == PromptCacheStrategy.EXPLICIT_SYSTEM
    ):
        system_content = [
            {
                "type": "text",
                "text": request.system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    payload: dict[str, object] = {
        "model": request.model,
        "messages": [
            {"role": "system", "content": system_content},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": request.user_prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data_url(request.image_path)},
                    },
                ],
            },
        ],
        "temperature": request.temperature,
        "max_tokens": request.max_output_tokens,
    }
    if options.top_p is not None:
        payload["top_p"] = options.top_p
    if options.seed is not None:
        payload["seed"] = options.seed
    if profile.provider_type == ProviderType.OPENROUTER:
        if options.service_tier is not None:
            payload["service_tier"] = options.service_tier.value
        if options.reasoning_effort is not None:
            payload["reasoning"] = {"effort": options.reasoning_effort.value}
    return payload


class OpenAICompatibleProvider:
    async def complete(
        self,
        profile: ProviderProfile,
        api_key: str,
        request: MultimodalRequest,
    ) -> ProviderResponse:
        url = f"{profile.base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if profile.provider_type == ProviderType.OPENROUTER:
            headers.update(
                {
                    "HTTP-Referer": "https://dataset-studio.local",
                    "X-Title": "Dataset Annotation Studio",
                }
            )
        payload = _build_payload(profile, request)

        try:
            async with httpx.AsyncClient(timeout=request.timeout_seconds) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as error:
            raise ProviderRequestError(f"API 请求失败：{error}") from error

        if not response.is_success:
            raise ProviderRequestError(
                f"API 返回 HTTP {response.status_code}",
                status_code=response.status_code,
                response_text=response.text,
            )
        try:
            raw = response.json()
        except ValueError as error:
            raise ProviderRequestError(
                "API 响应结构无法识别。", response_text=response.text
            ) from error
        return _parse_response(raw, response.text)
