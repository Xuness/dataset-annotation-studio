from dataset_studio.modules.presets.models import ProviderType
from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.gemini import GeminiProvider
from dataset_studio.modules.providers.openai_compatible import OpenAICompatibleProvider


def create_provider(provider_type: ProviderType) -> ModelProvider:
    if provider_type == ProviderType.GEMINI:
        return GeminiProvider()
    return OpenAICompatibleProvider()
