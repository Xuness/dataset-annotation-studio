import asyncio
import json
from contextlib import AbstractContextManager, nullcontext
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from dataset_studio.api.container import AppContainer
from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.exports.service import ExportService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.models import (
    ExecutionBackend,
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
from dataset_studio.modules.providers.config import (
    OpenAICompatibleModelOptions,
    ProviderModelConfig,
)
from dataset_studio.modules.providers.models import ProviderResponse
from dataset_studio.modules.statistics.service import StatisticsService
from dataset_studio.modules.taggers.downloads.repository import TaggerDownloadRepository
from dataset_studio.modules.taggers.downloads.service import TaggerDownloadService
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerExecutionProfile,
    TaggerInferenceResult,
    TaggerInferenceTag,
)
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.runtime import TaggerRuntime
from dataset_studio.modules.taggers.service import TaggerService
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


class StaticTaggerCatalog:
    profile = TaggerExecutionProfile(
        id="local-profile",
        name="Local test profile",
        installation_id="local-installation",
        installation_name="Local test model",
        adapter_id="test-adapter",
        model_version="v1",
        fingerprint="a" * 64,
        threshold=0.55,
        categories=["character", "general"],
        device=TaggerDevice.CPU,
        concurrency=1,
    )

    def resolve_execution_profile(self, profile_id: str) -> TaggerExecutionProfile:
        assert profile_id == self.profile.id
        return self.profile

    def catalog_guard(self) -> AbstractContextManager[None]:
        return nullcontext()


class StaticTaggerRuntime:
    def __init__(self) -> None:
        self.batch_sizes: list[int] = []

    def prune_missing_installations(self) -> None:
        pass

    def bind(self, _profile: TaggerExecutionProfile):
        return self

    @property
    def provider(self) -> str:
        return "CPUExecutionProvider"

    @property
    def prepared_tensor_bytes(self) -> int:
        return 3 * 8 * 8 * 4

    def effective_batch_size(self) -> int:
        return 4

    def record_batch_failure(self, _failed_batch_size: int) -> None:
        pass

    def preprocess_bytes(self, _payload: bytes):
        return np.zeros((3, 8, 8), dtype=np.float32)

    def infer_batch(self, prepared):
        self.batch_sizes.append(len(prepared))
        return [
            TaggerInferenceResult(
                content="alice, blue_hair",
                tags=[
                    TaggerInferenceTag(name="alice", category="character", confidence=0.91),
                    TaggerInferenceTag(name="blue_hair", category="general", confidence=0.84),
                ],
                provider="CPUExecutionProvider",
                inference_ms=12.5 / len(prepared),
                batch_size=len(prepared),
                batch_inference_ms=12.5,
            )
            for _ in prepared
        ]


def _runtime(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    translations = TranslationService(workspaces)
    secrets = MemorySecrets()
    presets = PresetService(PresetRepository(global_database), secrets)
    taggers = TaggerService(settings, TaggerRepository(global_database))
    tagger_downloads = TaggerDownloadService(
        TaggerDownloadRepository(global_database),
        taggers,
        secrets,
    )
    taggers.set_download_activity_check(tagger_downloads.repository.has_blocking_tasks)
    jobs = JobService(workspaces, presets, annotations, translations, taggers)
    assets = AssetService(workspaces)
    container = AppContainer(
        settings=settings,
        workspaces=workspaces,
        assets=assets,
        asset_deletions=AssetDeletionService(workspaces),
        annotations=annotations,
        translations=translations,
        presets=presets,
        jobs=jobs,
        annotation_traces=AnnotationTraceService(workspaces, assets, annotations),
        preprocessing=PreprocessService(workspaces),
        exports=ExportService(workspaces),
        statistics=StatisticsService(workspaces),
        codex=CodexRuntime(),
        taggers=taggers,
        tagger_downloads=tagger_downloads,
        tagger_runtime=TaggerRuntime(taggers),
    )
    return container, workspaces, presets, jobs


def test_idle_job_scheduler_does_not_scan_recent_workspaces(
    tmp_path: Path,
    monkeypatch,
) -> None:
    container, workspaces, _, _ = _runtime(tmp_path)
    project = tmp_path / "idle-dataset"
    project.mkdir()
    workspaces.open(str(project))

    def fail_recent_scan():
        raise AssertionError("idle scheduler must not enumerate recent workspaces")

    monkeypatch.setattr(workspaces, "list_recent", fail_recent_scan)

    AnnotationWorker(container)._schedule_available_items()


def test_llm_job_does_not_freeze_confirmed_tags_for_an_old_image(
    tmp_path: Path,
) -> None:
    container, workspaces, presets, jobs = _runtime(tmp_path)
    project = tmp_path / "dataset"
    project.mkdir()
    image_path = project / "sample.png"
    Image.new("RGB", (32, 32), "white").save(image_path)
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="Caption", system_prompt="Describe the image.")
    )
    workspaces.update_settings(
        workspace.project_id,
        WorkspaceSettingsUpdate(system_preset_id=system.id),
    )
    asset = container.assets.list_assets(workspace.project_id).items[0]
    container.annotations.save_tags(
        workspace.project_id,
        asset.id,
        [AnnotationTag(name="old_image_tag", origin="manual")],
        confirm=True,
    )

    Image.new("RGB", (64, 48), "black").save(image_path)
    workspaces.rescan(workspace.project_id)
    stale_tags = container.annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TAGS,
    )
    assert stale_tags.review_status.value == "stale"

    provider = presets.create_provider(
        ProviderProfileCreate(
            name="Provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            default_model_id="model",
            models=[
                ProviderModelConfig(
                    model_id="model",
                    protocol_options=OpenAICompatibleModelOptions(),
                )
            ],
            api_key="secret",
        )
    )
    job = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            scope=JobScope.ALL,
            use_confirmed_tags=True,
        ),
    )
    paths, _ = workspaces.get(workspace.project_id)

    assert (
        JobExecutionRepository(paths.database).annotation_input_revision(
            job.items[0].id,
            "tag_context",
        )
        is None
    )


@pytest.mark.asyncio
async def test_worker_runs_local_tagger_without_prompt_or_provider(
    tmp_path: Path,
) -> None:
    container, workspaces, presets, _ = _runtime(tmp_path)
    project = tmp_path / "local-tagger-dataset"
    project.mkdir()
    image_paths = [project / f"sample-{index}.png" for index in range(5)]
    for image_path in image_paths:
        Image.new("RGB", (48, 48), "white").save(image_path)
    workspace, _ = workspaces.open(str(project))
    deleted_asset = container.assets.list_assets(workspace.project_id).items[0]
    container.annotations.save_tags(
        workspace.project_id,
        deleted_asset.id,
        [AnnotationTag(name="deleted_before_rerun", origin="manual")],
    )
    container.annotations.delete(
        workspace.project_id,
        deleted_asset.id,
        AnnotationChannel.TAGS,
    )
    catalog = StaticTaggerCatalog()
    jobs = JobService(
        workspaces,
        presets,
        container.annotations,
        container.translations,
        catalog,  # type: ignore[arg-type]
    )
    container.jobs = jobs
    tagger_runtime = StaticTaggerRuntime()
    container.tagger_runtime = tagger_runtime  # type: ignore[assignment]
    created = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            execution_backend=ExecutionBackend.LOCAL_TAGGER,
            tagger_profile_id=catalog.profile.id,
            scope=JobScope.ALL,
        ),
    )

    worker = AnnotationWorker(container)
    stopped = asyncio.Event()
    worker_task = asyncio.create_task(worker.run(stopped))
    try:
        for _ in range(80):
            current = jobs.get(workspace.project_id, created.id)
            if current.status in {JobStatus.COMPLETED, JobStatus.COMPLETED_WITH_ERRORS}:
                break
            await asyncio.sleep(0.05)
        else:
            pytest.fail("worker did not complete the local tagger job")
    finally:
        stopped.set()
        await asyncio.wait_for(worker_task, timeout=2)

    detail = jobs.get(workspace.project_id, created.id)
    assert detail.status == JobStatus.COMPLETED
    assert detail.execution_backend == ExecutionBackend.LOCAL_TAGGER
    assert detail.execution_profile_name == "Local test profile"
    assert detail.provider_profile_id is None
    assert detail.system_preset_id is None
    assert len(detail.items) == 5
    assert all(item.status == JobItemStatus.SUCCEEDED for item in detail.items)
    assert tagger_runtime.batch_sizes == [4, 1]
    for item in detail.items:
        document = container.annotations.get_channel(
            workspace.project_id,
            item.asset_id,
            AnnotationChannel.TAGS,
        )
        assert [tag.name for tag in document.tags] == ["alice", "blue_hair"]
        assert document.tags[0].category == "character"
        assert document.tags[0].confidence == 0.91
        assert document.review_status.value == "unreviewed"
    assert all(not image_path.with_suffix(".txt").exists() for image_path in image_paths)
    trace = container.annotation_traces.get(workspace.project_id, detail.items[0].asset_id)
    assert trace is not None
    assert trace.matches_current_annotation
    assert trace.request.parameters.execution_backend == "local_tagger"
    assert trace.request.parameters.threshold == 0.55
    assert trace.response.final_content == "alice, blue_hair"


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
    asset = container.assets.list_assets(workspace.project_id).items[0]
    container.annotations.save_tags(
        workspace.project_id,
        asset.id,
        [
            AnnotationTag(name="blue_hair", category="general", origin="manual"),
            AnnotationTag(name="alice", category="character", origin="manual"),
        ],
        confirm=True,
    )
    container.annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        "<caption>deleted before rerun</caption>",
    )
    container.annotations.delete(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
    )
    profile = presets.create_provider(
        ProviderProfileCreate(
            name="Fake provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            default_model_id="fake-model",
            models=[
                ProviderModelConfig(
                    model_id="fake-model",
                    temperature=0.2,
                    protocol_options=OpenAICompatibleModelOptions(),
                ),
                ProviderModelConfig(
                    model_id="fake-model-alternate",
                    temperature=0.8,
                    max_output_tokens=8192,
                    protocol_options=OpenAICompatibleModelOptions(),
                ),
            ],
            api_key="local-test-key",
            concurrency=1,
        )
    )
    created = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=profile.id,
            model_id="fake-model-alternate",
            scope=JobScope.ALL,
            use_confirmed_tags=True,
        ),
    )
    frozen_tags = container.annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TAGS,
    )
    container.annotations.save_tags(
        workspace.project_id,
        asset.id,
        [AnnotationTag(name="changed_after_job_creation", origin="manual")],
        expected_head_revision_id=frozen_tags.head_revision_id,
        confirm=True,
    )
    presets.update_provider(
        profile.id,
        ProviderProfileUpdate(
            default_model_id="fake-model",
            models=[
                ProviderModelConfig(
                    model_id="fake-model",
                    temperature=0.1,
                    protocol_options=OpenAICompatibleModelOptions(),
                )
            ],
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

    stored = container.annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
    )
    assert stored.content == "<caption>quiet garden</caption>"
    assert stored.review_status.value == "unreviewed"
    assert not (project / "sample.txt").exists()
    expected_prompt = 'Describe the image.\n\nartist: Mori\nconfirmed_tags: ["blue_hair","alice"]'
    assert provider.requests[0].user_prompt == expected_prompt
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
    assert payload["request"]["user_prompt"] == expected_prompt
    assert payload["request"]["parameters"]["model"] == "fake-model-alternate"
    assert payload["request"]["parameters"]["temperature"] == 0.8
    assert payload["request"]["parameters"]["max_output_tokens"] == 8192
    assert payload["reasoning_content"] == "The scene contains a quiet garden."
    assert "local-test-key" not in payloads[0].read_text(encoding="utf-8")

    trace = container.annotation_traces.get(workspace.project_id, detail.items[0].asset_id)
    assert trace is not None
    assert trace.matches_current_annotation
    assert trace.request.source == "recorded"
    assert trace.request.user_prompt == expected_prompt
    assert trace.response.reasoning_content == "The scene contains a quiet garden."
    assert trace.response.final_content == "<caption>quiet garden</caption>"

    payloads[0].unlink()
    reconstructed = container.annotation_traces.get(
        workspace.project_id,
        detail.items[0].asset_id,
    )
    assert reconstructed is not None
    assert reconstructed.request.source == "reconstructed"
    assert reconstructed.request.user_prompt == expected_prompt


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
            default_model_id="fake-model",
            models=[
                ProviderModelConfig(
                    model_id="fake-model",
                    protocol_options=OpenAICompatibleModelOptions(),
                )
            ],
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
    container.annotations.save_text(
        workspace.project_id,
        asset.id,
        AnnotationChannel.DESCRIPTION,
        source,
        confirm=True,
    )
    profile = presets.create_provider(
        ProviderProfileCreate(
            name="Fake translator",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            default_model_id="fake-translation-model",
            models=[
                ProviderModelConfig(
                    model_id="fake-translation-model",
                    protocol_options=OpenAICompatibleModelOptions(),
                )
            ],
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

    assert not (project / "sample.txt").exists()
    assert not (project / "sample.zh-CN.txt").exists()
    stored_translation = container.annotations.get_channel(
        workspace.project_id,
        asset.id,
        AnnotationChannel.TRANSLATION,
        "zh-CN",
    )
    assert stored_translation.content == "<caption>安静的花园</caption>"
    assert provider.requests[0].image_path is None
    assert provider.requests[0].system_prompt == "Translate into 简体中文; locale=zh-CN."
    assert source in provider.requests[0].user_prompt
    translation = container.translations.get(workspace.project_id, asset.id, "zh-CN")
    assert translation.status.value == "current"
    assert translation.provider_profile_name == "Fake translator"
