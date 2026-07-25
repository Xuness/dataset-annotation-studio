from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.codex import CodexProvider
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.config import ProviderType
from dataset_studio.modules.providers.gemini import GeminiProvider
from dataset_studio.modules.providers.openai_compatible import OpenAICompatibleProvider
from dataset_studio.modules.providers.opencode_go.provider import OpenCodeGoProvider


def create_provider(
    provider_type: ProviderType,
    codex_runtime: CodexRuntime | None = None,
) -> ModelProvider:
    if provider_type == ProviderType.CODEX:
        if codex_runtime is None:
            raise ValueError("创建 Codex Provider 需要共享的 Codex Runtime。")
        return CodexProvider(codex_runtime)
    if provider_type == ProviderType.GEMINI:
        return GeminiProvider()
    if provider_type == ProviderType.OPENCODE_GO:
        return OpenCodeGoProvider()
    return OpenAICompatibleProvider()
