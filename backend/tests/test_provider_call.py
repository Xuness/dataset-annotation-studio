import asyncio
from pathlib import Path

import pytest

from dataset_studio.modules.jobs.provider_call import JobStopped, complete_until_stopped
from dataset_studio.modules.providers.config import (
    OpenAICompatibleModelOptions,
    ProviderExecutionProfile,
    ProviderModelConfig,
    ProviderType,
)
from dataset_studio.modules.providers.models import MultimodalRequest


class BlockingProvider:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def complete(self, _profile, _api_key, _request):
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


@pytest.mark.asyncio
async def test_in_flight_provider_request_is_cancelled_when_job_stops(tmp_path: Path) -> None:
    profile = ProviderExecutionProfile(
        id="profile",
        name="test",
        provider_type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.invalid/v1",
        concurrency=1,
        model=ProviderModelConfig(
            model_id="model",
            temperature=0.2,
            max_output_tokens=128,
            timeout_seconds=30,
            protocol_options=OpenAICompatibleModelOptions(),
        ),
    )
    request = MultimodalRequest(
        image_path=tmp_path / "unused.png",
        system_prompt="system",
        user_prompt="user",
    )
    provider = BlockingProvider()
    stop_requested = False
    task = asyncio.create_task(
        complete_until_stopped(
            provider,
            profile,
            "key",
            request,
            lambda: stop_requested,
            poll_interval=0.01,
        )
    )
    await provider.started.wait()
    stop_requested = True

    with pytest.raises(JobStopped):
        await asyncio.wait_for(task, timeout=1)
    assert provider.cancelled.is_set()
