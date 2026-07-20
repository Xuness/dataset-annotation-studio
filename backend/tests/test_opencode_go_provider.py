from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.modules.providers.config import (
    OpenCodeGoModelOptions,
    ProviderExecutionProfile,
    ProviderModelConfig,
    ProviderType,
    ReasoningEffort,
)
from dataset_studio.modules.providers.factory import create_provider
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.providers.opencode_go.anthropic_messages import (
    build_payload as build_messages_payload,
)
from dataset_studio.modules.providers.opencode_go.anthropic_messages import (
    parse_response as parse_messages_response,
)
from dataset_studio.modules.providers.opencode_go.catalog import models_from_catalog_ids
from dataset_studio.modules.providers.opencode_go.chat_completions import (
    build_payload as build_chat_payload,
)
from dataset_studio.modules.providers.opencode_go.chat_completions import (
    parse_response as parse_chat_response,
)
from dataset_studio.modules.providers.opencode_go.model_specs import get_model_spec
from dataset_studio.modules.providers.opencode_go.provider import OpenCodeGoProvider


def _profile(
    model: str,
    *,
    effort: ReasoningEffort | None = None,
    temperature: float = 0.2,
    max_output_tokens: int = 4096,
) -> ProviderExecutionProfile:
    return ProviderExecutionProfile(
        id="opencode-go",
        name="OpenCode Go",
        provider_type=ProviderType.OPENCODE_GO,
        base_url="https://opencode.ai/zen/go/v1",
        concurrency=2,
        model=ProviderModelConfig(
            model_id=model,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            timeout_seconds=180,
            protocol_options=OpenCodeGoModelOptions(reasoning_effort=effort),
        ),
    )


def _request(tmp_path: Path, profile: ProviderExecutionProfile) -> MultimodalRequest:
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (8, 8), "white").save(image_path)
    return MultimodalRequest(
        image_path=image_path,
        system_prompt="stable system prompt",
        user_prompt="describe this image",
    )


def test_catalog_intersects_live_ids_with_all_audited_model_specs() -> None:
    models = models_from_catalog_ids(
        ["glm-5.2", "unknown-model", "grok-4.5", "qwen3.7-plus", "grok-4.5"],
        "",
        40,
    )

    assert [model.id for model in models] == ["glm-5.2", "grok-4.5", "qwen3.7-plus"]
    assert models[0].input_modalities == ["text"]
    assert models[1].reasoning_efforts == ["low", "medium", "high"]
    assert "automatic_prompt_cache" in models[1].supported_parameters
    assert "explicit_prompt_cache" in models[2].supported_parameters


def test_chat_payload_sends_native_reasoning_effort_without_cache_control(
    tmp_path: Path,
) -> None:
    profile = _profile("grok-4.5", effort=ReasoningEffort.HIGH)
    request = _request(tmp_path, profile)
    spec = get_model_spec(profile.model_id)
    assert spec is not None

    payload = build_chat_payload(spec, profile, request)

    assert payload["reasoning_effort"] == "high"
    assert payload["temperature"] == 0.2
    assert payload["max_tokens"] == 4096
    assert payload["messages"][0] == {
        "role": "system",
        "content": "stable system prompt",
    }
    assert "cache_control" not in str(payload)
    assert payload["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )


def test_chat_payload_omits_temperature_for_models_that_do_not_accept_it(
    tmp_path: Path,
) -> None:
    profile = _profile("kimi-k2.7-code")
    request = _request(tmp_path, profile)
    spec = get_model_spec(profile.model_id)
    assert spec is not None

    payload = build_chat_payload(spec, profile, request)

    assert "temperature" not in payload


def test_opencode_go_payloads_support_text_only_requests(tmp_path: Path) -> None:
    chat_profile = _profile("grok-4.5")
    chat_request = _request(tmp_path, chat_profile)
    chat_request = MultimodalRequest(
        image_path=None,
        system_prompt=chat_request.system_prompt,
        user_prompt=chat_request.user_prompt,
    )
    chat_spec = get_model_spec(chat_profile.model_id)
    assert chat_spec is not None
    chat_payload = build_chat_payload(chat_spec, chat_profile, chat_request)
    assert chat_payload["messages"][1]["content"] == [
        {"type": "text", "text": "describe this image"}
    ]

    messages_profile = _profile("qwen3.7-plus")
    messages_spec = get_model_spec(messages_profile.model_id)
    assert messages_spec is not None
    messages_payload = build_messages_payload(
        messages_spec,
        messages_profile,
        MultimodalRequest(
            image_path=None,
            system_prompt="system",
            user_prompt="translate",
        ),
    )
    assert messages_payload["messages"][0]["content"] == [{"type": "text", "text": "translate"}]


def test_chat_response_records_cache_hits_and_reasoning_tokens() -> None:
    response = parse_chat_response(
        {
            "choices": [
                {
                    "message": {
                        "content": "<caption>lake</caption>",
                        "reasoning_content": "The image contains a lake.",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 40,
                "prompt_tokens_details": {"cached_tokens": 80},
                "completion_tokens_details": {"reasoning_tokens": 25},
            },
        },
        "unused",
    )

    assert response.input_tokens == 120
    assert response.output_tokens == 40
    assert response.cache_read_tokens == 80
    assert response.cache_write_tokens is None
    assert response.reasoning_tokens == 25
    assert response.reasoning_content == "The image contains a lake."


def test_messages_payload_uses_system_cache_breakpoint_and_thinking_budget(
    tmp_path: Path,
) -> None:
    profile = _profile("qwen3.7-plus", effort=ReasoningEffort.HIGH)
    request = _request(tmp_path, profile)
    spec = get_model_spec(profile.model_id)
    assert spec is not None

    payload = build_messages_payload(spec, profile, request)

    assert payload["system"] == [
        {
            "type": "text",
            "text": "stable system prompt",
            "cache_control": {"type": "ephemeral"},
        }
    ]
    assert payload["thinking"] == {"type": "enabled", "budget_tokens": 2047}
    assert "temperature" not in payload
    assert payload["messages"][0]["content"][1]["source"]["media_type"] == "image/png"


def test_messages_response_records_cache_creation_and_cache_reads() -> None:
    response = parse_messages_response(
        {
            "content": [
                {"type": "thinking", "thinking": "private chain"},
                {"type": "text", "text": "<caption>forest</caption>"},
            ],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 75,
                "output_tokens": 20,
                "cache_creation_input_tokens": 50,
                "cache_read_input_tokens": 25,
            },
        },
        "unused",
    )

    assert response.content == "<caption>forest</caption>"
    assert response.reasoning_content == "private chain"
    assert response.cache_write_tokens == 50
    assert response.cache_read_tokens == 25


@pytest.mark.asyncio
async def test_provider_dispatches_registered_model_to_its_transport(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = _profile("grok-4.5", effort=ReasoningEffort.LOW)
    request = _request(tmp_path, profile)
    captured: dict[str, object] = {}

    async def fake_complete(spec, received_profile, credential, received_request):
        captured.update(
            {
                "spec": spec,
                "profile": received_profile,
                "credential": credential,
                "request": received_request,
            }
        )
        return ProviderResponse(content="ok", raw_payload={})

    monkeypatch.setattr(
        "dataset_studio.modules.providers.opencode_go.chat_completions.complete",
        fake_complete,
    )

    response = await OpenCodeGoProvider().complete(profile, "secret", request)

    assert response.content == "ok"
    assert captured["credential"] == "secret"
    assert captured["request"] is request


@pytest.mark.asyncio
async def test_provider_allows_text_only_model_for_text_only_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = _profile("glm-5.2")
    request = MultimodalRequest(
        image_path=None,
        system_prompt="translate",
        user_prompt="source text",
    )
    captured: dict[str, object] = {}

    async def fake_complete(spec, received_profile, credential, received_request):
        captured.update(
            {
                "spec": spec,
                "profile": received_profile,
                "credential": credential,
                "request": received_request,
            }
        )
        return ProviderResponse(content="译文", raw_payload={})

    monkeypatch.setattr(
        "dataset_studio.modules.providers.opencode_go.chat_completions.complete",
        fake_complete,
    )

    response = await OpenCodeGoProvider().complete(profile, "secret", request)

    assert response.content == "译文"
    assert captured["request"] is request


@pytest.mark.asyncio
async def test_provider_rejects_text_only_model_when_request_contains_image(
    tmp_path: Path,
) -> None:
    profile = _profile("glm-5.2")
    request = _request(tmp_path, profile)

    with pytest.raises(ProviderRequestError, match="不支持图像输入"):
        await OpenCodeGoProvider().complete(profile, "secret", request)


@pytest.mark.asyncio
async def test_provider_fails_closed_for_unknown_model(tmp_path: Path) -> None:
    profile = _profile("future-unknown-model")
    request = _request(tmp_path, profile)

    with pytest.raises(ProviderRequestError, match="尚未登记协议规格"):
        await OpenCodeGoProvider().complete(profile, "secret", request)


def test_factory_exposes_independent_opencode_go_provider() -> None:
    assert isinstance(create_provider(ProviderType.OPENCODE_GO), OpenCodeGoProvider)
