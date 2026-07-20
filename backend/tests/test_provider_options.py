from pathlib import Path

import httpx
import pytest
from PIL import Image

from dataset_studio.modules.providers import catalog as provider_catalog
from dataset_studio.modules.providers.catalog import _parse_openrouter_model
from dataset_studio.modules.providers.config import (
    GeminiModelOptions,
    OpenAICompatibleModelOptions,
    OpenRouterModelOptions,
    PromptCacheStrategy,
    ProviderExecutionProfile,
    ProviderModelConfig,
    ProviderProtocolOptions,
    ProviderType,
    ReasoningEffort,
    ServiceTier,
)
from dataset_studio.modules.providers.gemini import _build_generation_config
from dataset_studio.modules.providers.models import MultimodalRequest
from dataset_studio.modules.providers.openai_compatible import _build_payload


def _profile(
    provider_type: ProviderType,
    protocol_options: ProviderProtocolOptions,
    *,
    base_url: str,
    temperature: float | None = 0.2,
    max_output_tokens: int = 4096,
    top_p: float | None = None,
    seed: int | None = None,
) -> ProviderExecutionProfile:
    return ProviderExecutionProfile(
        id="profile",
        name="Provider",
        provider_type=provider_type,
        base_url=base_url,
        concurrency=2,
        model=ProviderModelConfig(
            model_id="example/model",
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            timeout_seconds=180,
            top_p=top_p,
            seed=seed,
            protocol_options=protocol_options,
        ),
    )


def _request(image_path: Path | None, *, system_prompt: str = "system") -> MultimodalRequest:
    return MultimodalRequest(
        image_path=image_path,
        system_prompt=system_prompt,
        user_prompt="user",
    )


def test_openrouter_payload_includes_saved_advanced_options(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    profile = _profile(
        ProviderType.OPENROUTER,
        OpenRouterModelOptions(
            service_tier=ServiceTier.FLEX,
            reasoning_effort=ReasoningEffort.HIGH,
        ),
        base_url="https://openrouter.ai/api/v1",
        top_p=0.85,
        seed=42,
    )

    payload = _build_payload(profile, _request(image_path))

    assert payload["top_p"] == 0.85
    assert payload["seed"] == 42
    assert payload["service_tier"] == "flex"
    assert payload["reasoning"] == {"effort": "high"}
    assert "reasoning_effort" not in payload


def test_openrouter_payload_marks_system_prompt_as_cacheable(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    profile = _profile(
        ProviderType.OPENROUTER,
        OpenRouterModelOptions(prompt_cache_strategy=PromptCacheStrategy.EXPLICIT_SYSTEM),
        base_url="https://openrouter.ai/api/v1",
    )

    payload = _build_payload(
        profile,
        _request(image_path, system_prompt="stable system prompt"),
    )

    assert payload["messages"][0] == {
        "role": "system",
        "content": [
            {
                "type": "text",
                "text": "stable system prompt",
                "cache_control": {"type": "ephemeral"},
            }
        ],
    }


def test_openai_compatible_payload_uses_its_own_reasoning_shape(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    profile = _profile(
        ProviderType.OPENAI_COMPATIBLE,
        OpenAICompatibleModelOptions(reasoning_effort=ReasoningEffort.HIGH),
        base_url="https://example.invalid/v1",
    )

    payload = _build_payload(profile, _request(image_path))

    assert payload["messages"][0] == {"role": "system", "content": "system"}
    assert payload["reasoning_effort"] == "high"
    assert "reasoning" not in payload
    assert "service_tier" not in payload
    assert "cache_control" not in str(payload)


def test_openai_compatible_text_only_payload_omits_image() -> None:
    profile = _profile(
        ProviderType.OPENAI_COMPATIBLE,
        OpenAICompatibleModelOptions(),
        base_url="https://example.invalid/v1",
    )
    request = MultimodalRequest(
        image_path=None,
        system_prompt="translate",
        user_prompt="source text",
    )

    payload = _build_payload(profile, request)

    assert payload["messages"][1]["content"] == [{"type": "text", "text": "source text"}]
    assert "image_url" not in str(payload)


def test_openrouter_catalog_parser_exposes_picker_metadata() -> None:
    model = _parse_openrouter_model(
        {
            "id": "example/vision-model",
            "name": "Vision Model",
            "description": "A multimodal model.",
            "context_length": 131072,
            "architecture": {"input_modalities": ["text", "image"]},
            "supported_parameters": ["temperature", "reasoning"],
            "top_provider": {"max_completion_tokens": 16384},
            "pricing": {"prompt": "0.000001", "completion": "0.000002"},
            "reasoning": {"supported_efforts": ["high", "low"]},
        }
    )

    assert model.id == "example/vision-model"
    assert model.context_length == 131072
    assert model.max_output_tokens == 16384
    assert model.input_modalities == ["text", "image"]
    assert model.reasoning_efforts == ["high", "low"]
    assert model.prompt_price == "0.000001"
    assert model.capabilities_known is True


@pytest.mark.asyncio
async def test_openrouter_catalog_search_does_not_filter_modalities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_params: dict[str, str] = {}

    class FakeAsyncClient:
        def __init__(self, *, timeout: int) -> None:
            assert timeout == 30

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args) -> None:
            return None

        async def get(self, _url: str, *, headers, params):
            assert headers["Accept"] == "application/json"
            captured_params.update(params)
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "example/text-model",
                            "architecture": {"input_modalities": ["text"]},
                        },
                        {
                            "id": "example/image-model",
                            "architecture": {"input_modalities": ["text", "image"]},
                        },
                    ]
                },
            )

    monkeypatch.setattr(provider_catalog.httpx, "AsyncClient", FakeAsyncClient)

    models = await provider_catalog._search_openrouter_models(
        "https://openrouter.ai/api/v1",
        None,
        "cheap",
        40,
    )

    assert captured_params == {"sort": "most-popular", "q": "cheap"}
    assert [model.id for model in models] == [
        "example/text-model",
        "example/image-model",
    ]


@pytest.mark.asyncio
async def test_openai_compatible_catalog_uses_standard_models_endpoint_and_filters_locally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeAsyncClient:
        def __init__(self, *, timeout: int) -> None:
            assert timeout == 30

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args) -> None:
            return None

        async def get(self, url: str, *, headers):
            captured.update(url=url, headers=headers)
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": "vendor/text", "owned_by": "Vendor"},
                        {"id": "vendor/Vision", "name": "Vision Pro"},
                        {"id": "vendor/Vision", "name": "duplicate"},
                    ]
                },
            )

    monkeypatch.setattr(provider_catalog.httpx, "AsyncClient", FakeAsyncClient)

    models = await provider_catalog._search_openai_compatible_models(
        "https://compatible.example/v1/",
        "secret",
        "vision",
        10,
    )

    assert captured == {
        "url": "https://compatible.example/v1/models",
        "headers": {
            "Accept": "application/json",
            "Authorization": "Bearer secret",
        },
    }
    assert [model.id for model in models] == ["vendor/Vision"]
    assert models[0].capabilities_known is False
    assert models[0].input_modalities == []


def test_gemini_generation_config_maps_common_sampling_options(tmp_path: Path) -> None:
    profile = _profile(
        ProviderType.GEMINI,
        GeminiModelOptions(),
        base_url="https://generativelanguage.googleapis.com/v1beta",
        temperature=0.7,
        max_output_tokens=2048,
        top_p=0.9,
        seed=7,
    )

    assert _build_generation_config(profile, _request(tmp_path / "unused.png")) == {
        "temperature": 0.7,
        "maxOutputTokens": 2048,
        "topP": 0.9,
        "seed": 7,
    }
