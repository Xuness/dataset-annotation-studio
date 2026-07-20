from __future__ import annotations

from typing import Protocol

from dataset_studio.modules.providers.config import ProviderExecutionProfile
from dataset_studio.modules.providers.models import MultimodalRequest, ProviderResponse


class ModelProvider(Protocol):
    async def complete(
        self,
        profile: ProviderExecutionProfile,
        credential: str | None,
        request: MultimodalRequest,
    ) -> ProviderResponse: ...
