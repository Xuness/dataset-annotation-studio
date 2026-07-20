from __future__ import annotations

import httpx

from dataset_studio.modules.providers.models import ProviderModelSummary, ProviderRequestError
from dataset_studio.modules.providers.opencode_go.model_specs import get_model_spec


async def search_models(
    base_url: str,
    api_key: str | None,
    query: str,
    limit: int,
) -> list[ProviderModelSummary]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{base_url.rstrip('/')}/models",
                headers=headers,
            )
    except httpx.HTTPError as error:
        raise ProviderRequestError(f"获取 OpenCode Go 模型目录失败：{error}") from error
    if not response.is_success:
        raise ProviderRequestError(
            f"OpenCode Go 模型目录返回 HTTP {response.status_code}",
            status_code=response.status_code,
            response_text=response.text[:1000],
        )

    try:
        raw = response.json()
        if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
            raise TypeError("data is not a list")
        model_ids = [
            str(item["id"])
            for item in raw["data"]
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ]
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderRequestError(
            "OpenCode Go 模型目录结构无法识别。",
            response_text=response.text[:1000],
        ) from error
    return models_from_catalog_ids(model_ids, query, limit)


def models_from_catalog_ids(
    model_ids: list[str],
    query: str,
    limit: int,
) -> list[ProviderModelSummary]:
    needle = query.strip().casefold()
    results: list[ProviderModelSummary] = []
    seen: set[str] = set()
    for model_id in model_ids:
        if model_id in seen:
            continue
        seen.add(model_id)
        spec = get_model_spec(model_id)
        if spec is None:
            continue
        if needle and needle not in f"{spec.id}\n{spec.name}\n{spec.description}".casefold():
            continue
        results.append(spec.to_summary())
        if len(results) >= limit:
            break
    return results
