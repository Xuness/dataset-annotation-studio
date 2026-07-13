import asyncio
from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.models import (
    JobCreateRequest,
    JobItemStatus,
    JobScope,
    JobStatus,
)
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.jobs.worker import AnnotationWorker
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.models import (
    ProviderProfileCreate,
    ProviderType,
    SystemPresetCreate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.models import ProviderResponse
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.workspaces.models import WorkspaceSettingsUpdate
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database
from test_jobs import MemorySecrets


class RecordingProvider:
    def __init__(self) -> None:
        self.requests = []

    async def complete(self, _profile, _api_key, request):
        self.requests.append(request)
        return ProviderResponse(
            content="<caption>quiet garden</caption>",
            raw_payload={"source": "fake"},
            finish_reason="stop",
        )


def _runtime(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    presets = PresetService(PresetRepository(global_database), MemorySecrets())
    jobs = JobService(workspaces, presets, annotations)
    container = AppContainer(
        settings=settings,
        workspaces=workspaces,
        assets=AssetService(workspaces),
        annotations=annotations,
        presets=presets,
        jobs=jobs,
        preprocessing=PreprocessService(workspaces),
        statistics=StatisticsService(workspaces),
    )
    return container, workspaces, presets, jobs


@pytest.mark.asyncio
async def test_worker_completes_job_and_writes_exact_response(tmp_path: Path) -> None:
    container, workspaces, presets, jobs = _runtime(tmp_path)

    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (48, 48), "white").save(project / "sample.png")
    (project / "sample.json").write_text('{"artist":"Mori","unused":1}', encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="Balanced XML", system_prompt="Return one XML element.")
    )
    workspaces.update_settings(
        workspace.project_id,
        WorkspaceSettingsUpdate(
            system_preset_id=system.id,
            user_prompt="Describe the image.",
            json_fields=["artist"],
        ),
    )
    profile = presets.create_provider(
        ProviderProfileCreate(
            name="Fake provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="fake-model",
            api_key="local-test-key",
            concurrency=1,
        )
    )
    created = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=profile.id,
            scope=JobScope.ALL,
        ),
    )

    provider = RecordingProvider()
    worker = AnnotationWorker(container, provider_factory=lambda _kind: provider)
    stopped = asyncio.Event()
    worker_task = asyncio.create_task(worker.run(stopped))
    try:
        for _ in range(80):
            current = jobs.get(workspace.project_id, created.id)
            if current.status in {JobStatus.COMPLETED, JobStatus.COMPLETED_WITH_ERRORS}:
                break
            await asyncio.sleep(0.05)
        else:
            pytest.fail("worker did not complete the queued job")
    finally:
        stopped.set()
        await asyncio.wait_for(worker_task, timeout=2)

    assert (project / "sample.txt").read_text(encoding="utf-8") == (
        "<caption>quiet garden</caption>"
    )
    assert provider.requests[0].user_prompt == "Describe the image.\n\nartist: Mori"
    detail = jobs.get(workspace.project_id, created.id)
    assert detail.succeeded == 1
    assert detail.items[0].attempts[0].response_content == "<caption>quiet garden</caption>"
    payloads = list((project / ".annotation-workspace" / "runs").rglob("attempt-1.json"))
    assert len(payloads) == 1


@pytest.mark.asyncio
async def test_worker_marks_item_failed_when_image_disappears(tmp_path: Path) -> None:
    container, workspaces, presets, jobs = _runtime(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    image_path = project / "missing-before-request.png"
    Image.new("RGB", (48, 48), "white").save(image_path)
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="XML", system_prompt="Return one XML element.")
    )
    workspaces.update_settings(
        workspace.project_id,
        WorkspaceSettingsUpdate(system_preset_id=system.id),
    )
    profile = presets.create_provider(
        ProviderProfileCreate(
            name="Fake provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="fake-model",
            api_key="local-test-key",
            concurrency=1,
        )
    )
    created = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=profile.id,
            scope=JobScope.ALL,
        ),
    )
    image_path.unlink()

    provider = RecordingProvider()
    worker = AnnotationWorker(container, provider_factory=lambda _kind: provider)
    stopped = asyncio.Event()
    worker_task = asyncio.create_task(worker.run(stopped))
    try:
        for _ in range(80):
            current = jobs.get(workspace.project_id, created.id)
            if current.status in {JobStatus.COMPLETED, JobStatus.COMPLETED_WITH_ERRORS}:
                break
            await asyncio.sleep(0.05)
        else:
            pytest.fail("worker did not close the failed item")
    finally:
        stopped.set()
        await asyncio.wait_for(worker_task, timeout=2)

    detail = jobs.get(workspace.project_id, created.id)
    assert detail.status == JobStatus.COMPLETED_WITH_ERRORS
    assert detail.items[0].status == JobItemStatus.FAILED
    assert "图片已不存在" in (detail.items[0].last_error or "")
    assert detail.items[0].attempts == []
    assert provider.requests == []
