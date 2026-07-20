from __future__ import annotations

import asyncio
from collections.abc import Callable

from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.config import ProviderExecutionProfile
from dataset_studio.modules.providers.models import MultimodalRequest, ProviderResponse


class JobStopped(Exception):
    """Raised after an in-flight provider request has been cancelled by the user."""


async def complete_until_stopped(
    provider: ModelProvider,
    profile: ProviderExecutionProfile,
    credential: str | None,
    request: MultimodalRequest,
    is_stop_requested: Callable[[], bool],
    *,
    poll_interval: float = 0.5,
) -> ProviderResponse:
    request_task = asyncio.create_task(provider.complete(profile, credential, request))
    try:
        while not request_task.done():
            await asyncio.wait({request_task}, timeout=poll_interval)
            if not request_task.done() and is_stop_requested():
                request_task.cancel()
                await asyncio.gather(request_task, return_exceptions=True)
                raise JobStopped
        return request_task.result()
    except asyncio.CancelledError:
        request_task.cancel()
        await asyncio.gather(request_task, return_exceptions=True)
        raise
