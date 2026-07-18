from __future__ import annotations

import httpx

from dataset_studio.modules.presets.models import ProviderType
from dataset_studio.modules.providers.models import ProviderModelSummary, ProviderRequestError
from dataset_studio.modules.providers.opencode_go.catalog import (
    search_models as search_opencode_models,
)


async def search_provider_models(
    provider_type: ProviderType,
    base_url: str,
    api_key: str | None,
    query: str,
    limit: int,
) -> list[ProviderModelSummary]:
    if provider_type == ProviderType.OPENCODE_GO:
        return await search_opencode_models(base_url, api_key, query, limit)
    if provider_type != ProviderType.OPENROUTER:
        raise ValueError("模型目录搜索目前仅支持 OpenRouter 与 OpenCode Go 配置。")
    return await _search_openrouter_models(base_url, api_key, query, limit)


async def _search_openrouter_models(
    base_url: str,
    api_key: str | None,
    query: str,
    limit: int,
) -> list[ProviderModelSummary]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    params = {
        "input_modalities": "image",
        "output_modalities": "text",
        "sort": "most-popular",
    }
    if query.strip():
        params["q"] = query.strip()

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{base_url.rstrip('/')}/models",
                headers=headers,
                params=params,
            )
    except httpx.HTTPError as error:
        raise ProviderRequestError(f"获取模型目录失败：{error}") from error
    if not response.is_success:
        raise ProviderRequestError(
            f"模型目录返回 HTTP {response.status_code}",
            status_code=response.status_code,
            response_text=response.text[:1000],
        )

    try:
        items = response.json()["data"]
        if not isinstance(items, list):
            raise TypeError("data is not a list")
        return [_parse_openrouter_model(item) for item in items[:limit] if isinstance(item, dict)]
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderRequestError(
            "OpenRouter 模型目录结构无法识别。",
            response_text=response.text[:1000],
        ) from error


def _parse_openrouter_model(item: dict[str, object]) -> ProviderModelSummary:
    architecture = item.get("architecture") if isinstance(item.get("architecture"), dict) else {}
    top_provider = item.get("top_provider") if isinstance(item.get("top_provider"), dict) else {}
    pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
    reasoning = item.get("reasoning") if isinstance(item.get("reasoning"), dict) else {}
    return ProviderModelSummary(
        id=str(item.get("id", "")),
        name=str(item.get("name") or item.get("id") or "未命名模型"),
        description=str(item.get("description") or ""),
        context_length=_optional_int(item.get("context_length")),
        max_output_tokens=_optional_int(top_provider.get("max_completion_tokens")),
        input_modalities=_string_list(architecture.get("input_modalities")),
        supported_parameters=_string_list(item.get("supported_parameters")),
        reasoning_efforts=_string_list(reasoning.get("supported_efforts")),
        prompt_price=_optional_string(pricing.get("prompt")),
        completion_price=_optional_string(pricing.get("completion")),
    )


def _string_list(value: object) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _optional_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _optional_string(value: object) -> str | None:
    return str(value) if value is not None else None
