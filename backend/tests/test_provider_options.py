from pathlib import Path

from PIL import Image

from dataset_studio.modules.presets.models import (
    PromptCacheStrategy,
    ProviderProfile,
    ProviderRequestOptions,
    ProviderType,
    ReasoningEffort,
    ServiceTier,
)
from dataset_studio.modules.providers.catalog import _parse_openrouter_model
from dataset_studio.modules.providers.gemini import _build_generation_config
from dataset_studio.modules.providers.models import MultimodalRequest
from dataset_studio.modules.providers.openai_compatible import _build_payload


def test_openrouter_payload_includes_saved_advanced_options(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    profile = ProviderProfile(
        id="profile",
        name="OpenRouter",
        provider_type=ProviderType.OPENROUTER,
        base_url="https://openrouter.ai/api/v1",
        model="example/model",
        temperature=0.2,
        max_output_tokens=4096,
        concurrency=2,
        timeout_seconds=180,
        request_options=ProviderRequestOptions(
            top_p=0.85,
            seed=42,
            service_tier=ServiceTier.FLEX,
            reasoning_effort=ReasoningEffort.HIGH,
        ),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    request = MultimodalRequest(
        image_path=image_path,
        system_prompt="system",
        user_prompt="user",
        model=profile.model,
        temperature=profile.temperature,
        max_output_tokens=profile.max_output_tokens,
        timeout_seconds=profile.timeout_seconds,
    )

    payload = _build_payload(profile, request)

    assert payload["top_p"] == 0.85
    assert payload["seed"] == 42
    assert payload["service_tier"] == "flex"
    assert payload["reasoning"] == {"effort": "high"}


def test_openrouter_payload_marks_system_prompt_as_cacheable(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    profile = ProviderProfile(
        id="profile",
        name="OpenRouter",
        provider_type=ProviderType.OPENROUTER,
        base_url="https://openrouter.ai/api/v1",
        model="example/model",
        temperature=0.2,
        max_output_tokens=4096,
        concurrency=2,
        timeout_seconds=180,
        request_options=ProviderRequestOptions(
            prompt_cache_strategy=PromptCacheStrategy.EXPLICIT_SYSTEM
        ),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    request = MultimodalRequest(
        image_path=image_path,
        system_prompt="stable system prompt",
        user_prompt="dynamic user prompt",
        model=profile.model,
        temperature=profile.temperature,
        max_output_tokens=profile.max_output_tokens,
        timeout_seconds=profile.timeout_seconds,
    )

    payload = _build_payload(profile, request)

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
    assert payload["messages"][1]["content"][0] == {
        "type": "text",
        "text": "dynamic user prompt",
    }


def test_non_openrouter_payload_ignores_openrouter_cache_strategy(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    profile = ProviderProfile(
        id="profile",
        name="Compatible API",
        provider_type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.invalid/v1",
        model="example/model",
        temperature=0.2,
        max_output_tokens=4096,
        concurrency=2,
        timeout_seconds=180,
        request_options=ProviderRequestOptions(
            prompt_cache_strategy=PromptCacheStrategy.EXPLICIT_SYSTEM
        ),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    request = MultimodalRequest(
        image_path=image_path,
        system_prompt="system",
        user_prompt="user",
        model=profile.model,
        temperature=profile.temperature,
        max_output_tokens=profile.max_output_tokens,
        timeout_seconds=profile.timeout_seconds,
    )

    payload = _build_payload(profile, request)

    assert payload["messages"][0] == {"role": "system", "content": "system"}


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


def test_gemini_generation_config_maps_common_sampling_options(tmp_path: Path) -> None:
    profile = ProviderProfile(
        id="gemini",
        name="Gemini",
        provider_type=ProviderType.GEMINI,
        base_url="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-example",
        temperature=0.7,
        max_output_tokens=2048,
        concurrency=1,
        timeout_seconds=180,
        request_options=ProviderRequestOptions(top_p=0.9, seed=7),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    request = MultimodalRequest(
        image_path=tmp_path / "unused.png",
        system_prompt="system",
        user_prompt="user",
        model=profile.model,
        temperature=profile.temperature,
        max_output_tokens=profile.max_output_tokens,
        timeout_seconds=profile.timeout_seconds,
    )

    assert _build_generation_config(profile, request) == {
        "temperature": 0.7,
        "maxOutputTokens": 2048,
        "topP": 0.9,
        "seed": 7,
    }
