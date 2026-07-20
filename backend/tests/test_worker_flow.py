import asyncio
import json
from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.models import (
    ExistingTranslationPolicy,
    JobCreateRequest,
    JobItemStatus,
    JobKind,
    JobScope,
    JobStatus,
)
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.jobs.traces import AnnotationTraceService
from dataset_studio.modules.jobs.worker import AnnotationWorker
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.models import (
    ProviderProfileCreate,
    ProviderProfileUpdate,
    ProviderType,
    SystemPresetCreate,
    TranslationPromptPresetCreate,
    TranslationPromptPresetUpdate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.models import ProviderResponse
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.translations.service import TranslationService
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
            reasoning_content="The scene contains a quiet garden.",
            finish_reason="stop",
            input_tokens=120,
            output_tokens=30,
            cache_read_tokens=80,
            cache_write_tokens=10,
            reasoning_tokens=12,
        )


class TranslationProvider(RecordingProvider):
    async def complete(self, _profile, _api_key, request):
        self.requests.append(request)
        return ProviderResponse(
            content="<caption>安静的花园</caption>",
            raw_payload={"source": "fake-translation"},
            finish_reason="stop",
            input_tokens=80,
            output_tokens=20,
        )


def _runtime(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    translations = TranslationService(workspaces)
    presets = PresetService(PresetRepository(global_database), MemorySecrets())
    jobs = JobService(workspaces, presets, annotations, translations)
    assets = AssetService(workspaces)
    container = AppContainer(
        settings=settings,
        workspaces=workspaces,
        assets=assets,
        annotations=annotations,
        translations=translations,
        presets=presets,
        jobs=jobs,
        annotation_traces=AnnotationTraceService(workspaces, assets, annotations),
        preprocessing=PreprocessService(workspaces),
        statistics=StatisticsService(workspaces),
        codex=CodexRuntime(),
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
            models=["fake-model", "fake-model-alternate"],
            api_key="local-test-key",
            concurrency=1,
        )
    )
    created = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=profile.id,
            model="fake-model-alternate",
            scope=JobScope.ALL,
        ),
    )
    presets.update_provider(
        profile.id,
        ProviderProfileUpdate(model="fake-model", models=["fake-model"]),
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
    assert detail.items[0].attempts[0].cache_read_tokens == 80
    assert detail.items[0].attempts[0].cache_write_tokens == 10
    assert detail.items[0].attempts[0].reasoning_tokens == 12
    payloads = list((project / ".annotation-workspace" / "runs").rglob("attempt-1.json"))
    assert len(payloads) == 1
    payload = json.loads(payloads[0].read_text(encoding="utf-8"))
    assert payload["kind"] == "response"
    assert payload["request"]["system_prompt"] == "Return one XML element."
    assert payload["request"]["user_prompt"] == "Describe the image.\n\nartist: Mori"
    assert payload["request"]["parameters"]["model"] == "fake-model-alternate"
    assert payload["reasoning_content"] == "The scene contains a quiet garden."
    assert "local-test-key" not in payloads[0].read_text(encoding="utf-8")

    trace = container.annotation_traces.get(workspace.project_id, detail.items[0].asset_id)
    assert trace is not None
    assert trace.matches_current_annotation
    assert trace.request.source == "recorded"
    assert trace.request.user_prompt == "Describe the image.\n\nartist: Mori"
    assert trace.response.reasoning_content == "The scene contains a quiet garden."
    assert trace.response.final_content == "<caption>quiet garden</caption>"


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


@pytest.mark.asyncio
async def test_worker_translates_annotation_without_sending_image(tmp_path: Path) -> None:
    container, workspaces, presets, jobs = _runtime(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (48, 48), "white").save(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    asset = container.assets.list_assets(workspace.project_id).items[0]
    source = "<caption>quiet garden</caption>"
    container.annotations.save(workspace.project_id, asset.id, source)
    profile = presets.create_provider(
        ProviderProfileCreate(
            name="Fake translator",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="fake-translation-model",
            api_key="local-test-key",
            concurrency=1,
        )
    )
    prompt_preset = presets.create_translation_prompt(
        TranslationPromptPresetCreate(
            name="Snapshot translation",
            system_prompt="Translate into {target_language}; locale={language_code}.",
        )
    )
    created = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=profile.id,
            kind=JobKind.TRANSLATION,
            scope=JobScope.SELECTED,
            asset_ids=[asset.id],
            translation_prompt_preset_id=prompt_preset.id,
            target_language="zh-CN",
            translation_policy=ExistingTranslationPolicy.SKIP,
        ),
    )
    presets.update_translation_prompt(
        prompt_preset.id,
        TranslationPromptPresetUpdate(system_prompt="This later edit must not be used."),
    )

    provider = TranslationProvider()
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
            pytest.fail("worker did not complete the translation job")
    finally:
        stopped.set()
        await asyncio.wait_for(worker_task, timeout=2)

    assert (project / "sample.txt").read_text(encoding="utf-8") == source
    assert (project / "sample.zh-CN.txt").read_text(encoding="utf-8") == (
        "<caption>安静的花园</caption>"
    )
    assert provider.requests[0].image_path is None
    assert provider.requests[0].system_prompt == "Translate into 简体中文; locale=zh-CN."
    assert source in provider.requests[0].user_prompt
    translation = container.translations.get(workspace.project_id, asset.id, "zh-CN")
    assert translation.status.value == "current"
    assert translation.provider_profile_name == "Fake translator"
