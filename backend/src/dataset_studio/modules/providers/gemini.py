from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import ProviderProfile
from dataset_studio.modules.providers.media import encode_image_base64, image_mime_type
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.providers.reasoning import extract_gemini_reasoning


def _build_generation_config(
    profile: ProviderProfile,
    request: MultimodalRequest,
) -> dict[str, object]:
    config: dict[str, object] = {
        "temperature": request.temperature,
        "maxOutputTokens": request.max_output_tokens,
    }
    options = profile.request_options
    if options.top_p is not None:
        config["topP"] = options.top_p
    if options.seed is not None:
        config["seed"] = options.seed
    return config


class GeminiProvider:
    async def complete(
        self,
        profile: ProviderProfile,
        credential: str | None,
        request: MultimodalRequest,
    ) -> ProviderResponse:
        if not credential:
            raise ProviderRequestError("当前 API 配置尚未保存 API Key。")
        base_url = profile.base_url.rstrip("/")
        url = f"{base_url}/models/{request.model}:generateContent"
        parts: list[dict[str, object]] = [{"text": request.user_prompt}]
        if request.image_path is not None:
            parts.append(
                {
                    "inlineData": {
                        "mimeType": image_mime_type(request.image_path),
                        "data": encode_image_base64(request.image_path),
                    }
                }
            )
        payload = {
            "systemInstruction": {"parts": [{"text": request.system_prompt}]},
            "contents": [
                {
                    "role": "user",
                    "parts": parts,
                }
            ],
            "generationConfig": _build_generation_config(profile, request),
        }
        try:
            async with httpx.AsyncClient(timeout=request.timeout_seconds) as client:
                response = await client.post(url, params={"key": credential}, json=payload)
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
            parts = candidate["content"].get("parts", [])
            content = "".join(
                str(part.get("text", ""))
                for part in parts
                if isinstance(part, dict) and part.get("thought") is not True
            )
            usage = raw.get("usageMetadata") or {}
            return ProviderResponse(
                content=content,
                raw_payload=raw,
                reasoning_content=extract_gemini_reasoning(parts),
                finish_reason=candidate.get("finishReason"),
                input_tokens=usage.get("promptTokenCount"),
                output_tokens=usage.get("candidatesTokenCount"),
                cache_read_tokens=usage.get("cachedContentTokenCount"),
                reasoning_tokens=usage.get("thoughtsTokenCount"),
            )
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ProviderRequestError(
                "Gemini 响应结构无法识别。", response_text=response.text
            ) from error
