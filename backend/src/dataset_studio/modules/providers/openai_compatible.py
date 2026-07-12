from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import ProviderProfile, ProviderType
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
        payload = {
            "model": request.model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
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
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ProviderRequestError(
                "API 响应结构无法识别。", response_text=response.text
            ) from error
