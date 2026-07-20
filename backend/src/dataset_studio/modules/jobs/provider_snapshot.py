from __future__ import annotations

import json

from dataset_studio.modules.providers.config import (
    CodexModelOptions,
    GeminiModelOptions,
    OpenAICompatibleModelOptions,
    OpenCodeGoModelOptions,
    OpenRouterModelOptions,
    ProviderExecutionProfile,
    ProviderModelConfig,
    ProviderType,
)


def load_provider_snapshot(
    value: str | dict[str, object],
) -> ProviderExecutionProfile:
    """Load current snapshots and normalize pre-v2 jobs without rewriting them."""

    raw = json.loads(value) if isinstance(value, str) else value
    if not isinstance(raw, dict):
        raise ValueError("任务中的模型连接快照结构无法识别。")
    if raw.get("snapshot_version") == 2:
        return ProviderExecutionProfile.model_validate(raw)
    return _load_legacy_snapshot(raw)


def _load_legacy_snapshot(raw: dict[str, object]) -> ProviderExecutionProfile:
    provider_type = ProviderType(str(raw["provider_type"]))
    request_options = raw.get("request_options")
    options = request_options if isinstance(request_options, dict) else {}
    reasoning_effort = options.get("reasoning_effort")

    if provider_type == ProviderType.OPENROUTER:
        protocol_options = OpenRouterModelOptions(
            service_tier=options.get("service_tier"),
            reasoning_effort=reasoning_effort,
            prompt_cache_strategy=options.get("prompt_cache_strategy"),
        )
    elif provider_type == ProviderType.OPENAI_COMPATIBLE:
        protocol_options = OpenAICompatibleModelOptions(
            reasoning_effort=reasoning_effort,
        )
    elif provider_type == ProviderType.OPENCODE_GO:
        protocol_options = OpenCodeGoModelOptions(
            reasoning_effort=reasoning_effort,
        )
    elif provider_type == ProviderType.GEMINI:
        protocol_options = GeminiModelOptions()
    else:
        protocol_options = CodexModelOptions(
            reasoning_effort=reasoning_effort,
        )

    return ProviderExecutionProfile(
        id=str(raw["id"]),
        name=str(raw.get("name") or "未命名 API 配置"),
        provider_type=provider_type,
        base_url=str(raw.get("base_url") or ""),
        concurrency=int(raw.get("concurrency") or 1),
        model=ProviderModelConfig(
            model_id=str(raw["model"]),
            temperature=raw.get("temperature"),
            max_output_tokens=int(raw.get("max_output_tokens") or 4096),
            timeout_seconds=int(raw.get("timeout_seconds") or 180),
            top_p=options.get("top_p"),
            seed=options.get("seed"),
            protocol_options=protocol_options,
        ),
    )
