from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import ProviderProfile
from dataset_studio.modules.providers.media import encode_image_base64, image_mime_type
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)


class GeminiProvider:
    async def complete(
        self,
        profile: ProviderProfile,
        api_key: str,
        request: MultimodalRequest,
    ) -> ProviderResponse:
        base_url = profile.base_url.rstrip("/")
        url = f"{base_url}/models/{request.model}:generateContent"
        payload = {
            "systemInstruction": {"parts": [{"text": request.system_prompt}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": request.user_prompt},
                        {
                            "inlineData": {
                                "mimeType": image_mime_type(request.image_path),
                                "data": encode_image_base64(request.image_path),
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {
                "temperature": request.temperature,
                "maxOutputTokens": request.max_output_tokens,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=request.timeout_seconds) as client:
                response = await client.post(url, params={"key": api_key}, json=payload)
        except httpx.HTTPError as error:
            raise ProviderRequestError(f"Gemini 请求失败：{error}") from error

        if not response.is_success:
            raise ProviderRequestError(
                f"Gemini 返回 HTTP {response.status_code}",
                status_code=response.status_code,
                response_text=response.text,
            )
        try:
            raw = response.json()
            candidate = raw["candidates"][0]
            content = "".join(
                str(part.get("text", ""))
                for part in candidate["content"].get("parts", [])
                if isinstance(part, dict)
            )
            usage = raw.get("usageMetadata") or {}
            return ProviderResponse(
                content=content,
                raw_payload=raw,
                finish_reason=candidate.get("finishReason"),
                input_tokens=usage.get("promptTokenCount"),
                output_tokens=usage.get("candidatesTokenCount"),
            )
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ProviderRequestError(
                "Gemini 响应结构无法识别。", response_text=response.text
            ) from error
