from dataset_studio.modules.jobs.provider_snapshot import load_provider_snapshot
from dataset_studio.modules.providers.config import (
    OpenAICompatibleModelOptions,
    ProviderExecutionProfile,
    ProviderModelConfig,
    ProviderType,
    ReasoningEffort,
)


def test_current_provider_snapshot_round_trips_without_conversion() -> None:
    expected = ProviderExecutionProfile(
        id="profile",
        name="Compatible API",
        provider_type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.invalid/v1",
        concurrency=3,
        model=ProviderModelConfig(
            model_id="model/vision",
            temperature=0.7,
            max_output_tokens=8192,
            timeout_seconds=240,
            top_p=0.9,
            seed=7,
            protocol_options=OpenAICompatibleModelOptions(reasoning_effort=ReasoningEffort.HIGH),
        ),
    )

    loaded = load_provider_snapshot(expected.model_dump_json())

    assert loaded == expected


def test_legacy_provider_snapshot_is_normalized_in_memory() -> None:
    loaded = load_provider_snapshot(
        {
            "id": "legacy-profile",
            "name": "Legacy compatible API",
            "provider_type": "openai_compatible",
            "base_url": "https://legacy.example/v1",
            "model": "legacy/model",
            "temperature": 0.4,
            "max_output_tokens": 2048,
            "concurrency": 2,
            "timeout_seconds": 90,
            "request_options": {
                "top_p": 0.8,
                "seed": 42,
                "reasoning_effort": "medium",
            },
        }
    )

    assert loaded.snapshot_version == 2
    assert loaded.model_id == "legacy/model"
    assert loaded.model.temperature == 0.4
    assert loaded.model.max_output_tokens == 2048
    assert loaded.model.timeout_seconds == 90
    assert loaded.model.top_p == 0.8
    assert loaded.model.seed == 42
    assert loaded.model.protocol_options == OpenAICompatibleModelOptions(
        reasoning_effort=ReasoningEffort.MEDIUM
    )
