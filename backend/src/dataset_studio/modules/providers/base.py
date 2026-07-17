from __future__ import annotations

from typing import Protocol

from dataset_studio.modules.presets.models import ProviderProfile
from dataset_studio.modules.providers.models import MultimodalRequest, ProviderResponse


class ModelProvider(Protocol):
    async def complete(
        self,
        profile: ProviderProfile,
        credential: str | None,
        request: MultimodalRequest,
    ) -> ProviderResponse: ...
