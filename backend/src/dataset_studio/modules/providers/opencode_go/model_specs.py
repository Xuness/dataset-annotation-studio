from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from dataset_studio.modules.providers.config import ReasoningEffort
from dataset_studio.modules.providers.models import ProviderModelSummary


class OpenCodeGoTransport(StrEnum):
    CHAT_COMPLETIONS = "chat_completions"
    ANTHROPIC_MESSAGES = "anthropic_messages"


class OpenCodeGoCacheMode(StrEnum):
    AUTOMATIC_PREFIX = "automatic_prefix"
    EXPLICIT_SYSTEM = "explicit_system"


@dataclass(frozen=True, slots=True)
class OpenCodeGoModelSpec:
    id: str
    name: str
    description: str
    transport: OpenCodeGoTransport
    input_modalities: tuple[str, ...]
    supports_temperature: bool
    reasoning_efforts: tuple[ReasoningEffort, ...]
    cache_mode: OpenCodeGoCacheMode
    context_length: int
    max_output_tokens: int
    prompt_price: str
    completion_price: str
    max_reasoning_budget: int | None = None

    def to_summary(self) -> ProviderModelSummary:
        parameters: list[str] = []
        if self.supports_temperature:
            parameters.append("temperature")
        if self.reasoning_efforts:
            parameters.append("reasoning_effort")
        if self.cache_mode == OpenCodeGoCacheMode.AUTOMATIC_PREFIX:
            parameters.append("automatic_prompt_cache")
        else:
            parameters.append("explicit_prompt_cache")
        return ProviderModelSummary(
            id=self.id,
            name=self.name,
            description=self.description,
            context_length=self.context_length,
            max_output_tokens=self.max_output_tokens,
            input_modalities=list(self.input_modalities),
            supported_parameters=parameters,
            reasoning_efforts=[effort.value for effort in self.reasoning_efforts],
            prompt_price=self.prompt_price,
            completion_price=self.completion_price,
            capabilities_known=True,
        )


_CHAT = OpenCodeGoTransport.CHAT_COMPLETIONS
_MESSAGES = OpenCodeGoTransport.ANTHROPIC_MESSAGES
_AUTOMATIC = OpenCodeGoCacheMode.AUTOMATIC_PREFIX
_EXPLICIT = OpenCodeGoCacheMode.EXPLICIT_SYSTEM

# Audited OpenCode Go capabilities as of 2026-07-18. The runtime catalog intersects
# these specs with /models so removed models disappear without guessing new protocols.
MODEL_SPECS: dict[str, OpenCodeGoModelSpec] = {
    spec.id: spec
    for spec in (
        OpenCodeGoModelSpec(
            id="grok-4.5",
            name="Grok 4.5",
            description="OpenAI 兼容通道；支持图像输入、推理强度与自动前缀缓存。",
            transport=_CHAT,
            input_modalities=("text", "image"),
            supports_temperature=True,
            reasoning_efforts=(
                ReasoningEffort.LOW,
                ReasoningEffort.MEDIUM,
                ReasoningEffort.HIGH,
            ),
            cache_mode=_AUTOMATIC,
            context_length=500_000,
            max_output_tokens=500_000,
            prompt_price="0.000002",
            completion_price="0.000006",
        ),
        OpenCodeGoModelSpec(
            id="glm-5.2",
            name="GLM 5.2",
            description="OpenAI 兼容通道；文本模型，保留规格用于已保存配置校验。",
            transport=_CHAT,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.HIGH, ReasoningEffort.MAX),
            cache_mode=_AUTOMATIC,
            context_length=1_000_000,
            max_output_tokens=131_072,
            prompt_price="0.0000014",
            completion_price="0.0000044",
        ),
        OpenCodeGoModelSpec(
            id="glm-5.1",
            name="GLM 5.1",
            description="OpenAI 兼容通道；文本模型，使用模型默认推理行为。",
            transport=_CHAT,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_AUTOMATIC,
            context_length=202_752,
            max_output_tokens=32_768,
            prompt_price="0.0000014",
            completion_price="0.0000044",
        ),
        OpenCodeGoModelSpec(
            id="kimi-k3",
            name="Kimi K3",
            description="OpenAI 兼容通道；支持图像与视频输入、Max 推理强度和自动缓存。",
            transport=_CHAT,
            input_modalities=("text", "image", "video"),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.MAX,),
            cache_mode=_AUTOMATIC,
            context_length=1_048_576,
            max_output_tokens=131_072,
            prompt_price="0.000003",
            completion_price="0.000015",
        ),
        OpenCodeGoModelSpec(
            id="kimi-k2.7-code",
            name="Kimi K2.7 Code",
            description="OpenAI 兼容通道；支持图像与视频输入，采样参数由模型管理。",
            transport=_CHAT,
            input_modalities=("text", "image", "video"),
            supports_temperature=False,
            reasoning_efforts=(),
            cache_mode=_AUTOMATIC,
            context_length=262_144,
            max_output_tokens=262_144,
            prompt_price="0.00000095",
            completion_price="0.000004",
        ),
        OpenCodeGoModelSpec(
            id="kimi-k2.6",
            name="Kimi K2.6",
            description="OpenAI 兼容通道；支持图像与视频输入并使用自动前缀缓存。",
            transport=_CHAT,
            input_modalities=("text", "image", "video"),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_AUTOMATIC,
            context_length=262_144,
            max_output_tokens=65_536,
            prompt_price="0.00000095",
            completion_price="0.000004",
        ),
        OpenCodeGoModelSpec(
            id="deepseek-v4-pro",
            name="DeepSeek V4 Pro",
            description="OpenAI 兼容通道；文本模型，支持 High 与 Max 推理强度。",
            transport=_CHAT,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.HIGH, ReasoningEffort.MAX),
            cache_mode=_AUTOMATIC,
            context_length=1_000_000,
            max_output_tokens=384_000,
            prompt_price="0.000000435",
            completion_price="0.00000087",
        ),
        OpenCodeGoModelSpec(
            id="deepseek-v4-flash",
            name="DeepSeek V4 Flash",
            description="OpenAI 兼容通道；文本模型，支持 High 与 Max 推理强度。",
            transport=_CHAT,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.HIGH, ReasoningEffort.MAX),
            cache_mode=_AUTOMATIC,
            context_length=1_000_000,
            max_output_tokens=384_000,
            prompt_price="0.00000014",
            completion_price="0.00000028",
        ),
        OpenCodeGoModelSpec(
            id="mimo-v2.5",
            name="MiMo V2.5",
            description="OpenAI 兼容通道；支持图像、音频与视频输入和自动前缀缓存。",
            transport=_CHAT,
            input_modalities=("text", "image", "audio", "video"),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_AUTOMATIC,
            context_length=1_000_000,
            max_output_tokens=128_000,
            prompt_price="0.00000014",
            completion_price="0.00000028",
        ),
        OpenCodeGoModelSpec(
            id="mimo-v2.5-pro",
            name="MiMo V2.5 Pro",
            description="OpenAI 兼容通道；文本模型，使用模型默认推理行为。",
            transport=_CHAT,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_AUTOMATIC,
            context_length=1_048_576,
            max_output_tokens=128_000,
            prompt_price="0.000000435",
            completion_price="0.00000087",
        ),
        OpenCodeGoModelSpec(
            id="minimax-m3",
            name="MiniMax M3",
            description="Anthropic Messages 通道；支持图像与视频输入和显式 System 缓存。",
            transport=_MESSAGES,
            input_modalities=("text", "image", "video"),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_EXPLICIT,
            context_length=1_000_000,
            max_output_tokens=131_072,
            prompt_price="0.0000003",
            completion_price="0.0000012",
        ),
        OpenCodeGoModelSpec(
            id="minimax-m2.7",
            name="MiniMax M2.7",
            description="Anthropic Messages 通道；文本模型，支持显式 System 缓存。",
            transport=_MESSAGES,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_EXPLICIT,
            context_length=204_800,
            max_output_tokens=131_072,
            prompt_price="0.0000003",
            completion_price="0.0000012",
        ),
        OpenCodeGoModelSpec(
            id="minimax-m2.5",
            name="MiniMax M2.5",
            description="Anthropic Messages 通道；已弃用文本模型，仅保留旧配置识别。",
            transport=_MESSAGES,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(),
            cache_mode=_EXPLICIT,
            context_length=204_800,
            max_output_tokens=65_536,
            prompt_price="0.0000003",
            completion_price="0.0000012",
        ),
        OpenCodeGoModelSpec(
            id="qwen3.7-max",
            name="Qwen 3.7 Max",
            description="Anthropic Messages 通道；文本模型，支持预算式 High 与 Max 推理。",
            transport=_MESSAGES,
            input_modalities=("text",),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.HIGH, ReasoningEffort.MAX),
            cache_mode=_EXPLICIT,
            context_length=1_000_000,
            max_output_tokens=65_536,
            prompt_price="0.0000025",
            completion_price="0.0000075",
            max_reasoning_budget=262_144,
        ),
        OpenCodeGoModelSpec(
            id="qwen3.7-plus",
            name="Qwen 3.7 Plus",
            description="Anthropic Messages 通道；支持图像、视频、预算式推理与显式缓存。",
            transport=_MESSAGES,
            input_modalities=("text", "image", "video"),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.HIGH, ReasoningEffort.MAX),
            cache_mode=_EXPLICIT,
            context_length=1_000_000,
            max_output_tokens=65_536,
            prompt_price="0.0000004",
            completion_price="0.0000016",
            max_reasoning_budget=262_144,
        ),
        OpenCodeGoModelSpec(
            id="qwen3.6-plus",
            name="Qwen 3.6 Plus",
            description="Anthropic Messages 通道；支持图像、视频、预算式推理与显式缓存。",
            transport=_MESSAGES,
            input_modalities=("text", "image", "video"),
            supports_temperature=True,
            reasoning_efforts=(ReasoningEffort.HIGH, ReasoningEffort.MAX),
            cache_mode=_EXPLICIT,
            context_length=1_000_000,
            max_output_tokens=65_536,
            prompt_price="0.0000005",
            completion_price="0.000003",
            max_reasoning_budget=81_920,
        ),
    )
}


def get_model_spec(model_id: str) -> OpenCodeGoModelSpec | None:
    return MODEL_SPECS.get(model_id)
