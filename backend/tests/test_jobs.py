from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import (
    JobCreateRequest,
    JobItemStatus,
    JobScope,
    JobStatus,
)
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.presets.models import (
    ProviderProfileCreate,
    ProviderType,
    SystemPresetCreate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.workspaces.models import WorkspaceSettingsUpdate
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


class MemorySecrets:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        self.values[key] = value

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


def _single_item_job(tmp_path: Path):
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    presets = PresetService(PresetRepository(global_database), MemorySecrets())
    jobs = JobService(workspaces, presets, annotations)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (32, 32), "white").save(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="XML", system_prompt="Return balanced tags.")
    )
    workspaces.update_settings(
        workspace.project_id,
        WorkspaceSettingsUpdate(system_preset_id=system.id),
    )
    provider = presets.create_provider(
        ProviderProfileCreate(
            name="Provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="example/model",
            api_key="secret",
        )
    )
    job = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            scope=JobScope.ALL,
        ),
    )
    paths, _ = workspaces.get(workspace.project_id)
    return jobs, workspace.project_id, job, paths.database, project


def _fail_item(
    database: Path,
    item_id: str,
    *,
    attempt_status: str,
    response_content: str,
) -> int:
    execution = JobExecutionRepository(database)
    attempt_id, attempt_number = execution.start_attempt(item_id)
    execution.finish_attempt(
        attempt_id,
        status=attempt_status,
        response_content=response_content,
        error_message="simulated failure",
    )
    execution.finish_item(
        item_id,
        JobItemStatus.FAILED,
        error="simulated failure",
        validation_status="failed",
    )
    JobLifecycleRepository(database).finalize_jobs()
    return attempt_number


def test_job_creation_skips_existing_txt_and_snapshots_presets(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    presets = PresetService(PresetRepository(global_database), MemorySecrets())
    jobs = JobService(workspaces, presets, annotations)

    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (32, 32), "white").save(project / "already.png")
    Image.new("RGB", (32, 32), "black").save(project / "pending.png")
    (project / "already.txt").write_text("<done />", encoding="utf-8")
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="XML caption", system_prompt="Return balanced tags.")
    )
    workspaces.update_settings(
        workspace.project_id,
        WorkspaceSettingsUpdate(system_preset_id=system.id),
    )
    provider = presets.create_provider(
        ProviderProfileCreate(
            name="OpenRouter",
            provider_type=ProviderType.OPENROUTER,
            base_url="https://openrouter.ai/api/v1",
            model="example/model",
            models=["example/model", "example/alternate"],
            api_key="secret",
        )
    )

    job = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            model="example/alternate",
            scope=JobScope.ALL,
        ),
    )

    assert job.total == 1
    assert job.items[0].relative_path == "pending.png"
    assert job.system_preset_name == "XML caption"
    assert job.provider_profile_name == "OpenRouter"
    assert job.model == "example/alternate"
    assert [entry.id for entry in jobs.list(workspace.project_id, active_only=True)] == [job.id]
    assert jobs.active_overview().count == 1
    assert jobs.active_overview().project_count == 1
    assert jobs.stop_all_workspaces() == 1

    with pytest.raises(ValueError, match=r"不在.*模型列表"):
        jobs.create(
            workspace.project_id,
            JobCreateRequest(
                provider_profile_id=provider.id,
                model="unknown/model",
                scope=JobScope.ALL,
            ),
        )


def test_job_creation_requires_project_system_preset(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    annotations = AnnotationService(workspaces)
    presets = PresetService(PresetRepository(global_database), MemorySecrets())
    jobs = JobService(workspaces, presets, annotations)

    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (32, 32), "white").save(project / "sample.png")
    workspace, _ = workspaces.open(str(project))
    provider = presets.create_provider(
        ProviderProfileCreate(
            name="Provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="example/model",
            api_key="secret",
        )
    )

    with pytest.raises(ValueError, match="素材页"):
        jobs.create(
            workspace.project_id,
            JobCreateRequest(provider_profile_id=provider.id, scope=JobScope.ALL),
        )


def test_manual_accept_rejects_provider_error_response(tmp_path: Path) -> None:
    jobs, project_id, job, database, project = _single_item_job(tmp_path)
    item = job.items[0]
    _fail_item(
        database,
        item.id,
        attempt_status="request_failed",
        response_content='{"error":"upstream unavailable"}',
    )

    with pytest.raises(ValueError, match="没有可以人工采用"):
        jobs.manually_accept(project_id, job.id, item.id)

    assert not (project / "sample.txt").exists()
    assert jobs.get(project_id, job.id).status == JobStatus.COMPLETED_WITH_ERRORS
    assert jobs.list(project_id, active_only=True) == []


def test_manual_accept_uses_validation_failure_and_completes_job(tmp_path: Path) -> None:
    jobs, project_id, job, database, project = _single_item_job(tmp_path)
    item = job.items[0]
    invalid_response = "<caption>needs manual acceptance"
    _fail_item(
        database,
        item.id,
        attempt_status="validation_failed",
        response_content=invalid_response,
    )

    accepted = jobs.manually_accept(project_id, job.id, item.id)

    assert (project / "sample.txt").read_text(encoding="utf-8") == invalid_response
    assert accepted.status == JobStatus.COMPLETED
    assert accepted.manually_accepted == 1
    assert accepted.failed == 0
    assert accepted.items[0].status == JobItemStatus.MANUALLY_ACCEPTED


def test_failed_only_retry_keeps_attempt_numbers_unique(tmp_path: Path) -> None:
    jobs, project_id, job, database, _ = _single_item_job(tmp_path)
    item = job.items[0]
    assert (
        _fail_item(
            database,
            item.id,
            attempt_status="validation_failed",
            response_content="<caption>invalid",
        )
        == 1
    )

    retried = jobs.retry_failed(project_id, job.id)
    assert retried.status == JobStatus.QUEUED
    claimed = JobExecutionRepository(database).claim_items(job.id, 1)
    assert [row["id"] for row in claimed] == [item.id]
    _, next_attempt_number = JobExecutionRepository(database).start_attempt(item.id)
    assert next_attempt_number == 2

    with pytest.raises(ValueError, match="已经结束"):
        jobs.retry_failed(project_id, job.id)


def test_failed_job_item_appears_in_review_until_retry(tmp_path: Path) -> None:
    jobs, project_id, job, database, _ = _single_item_job(tmp_path)
    item = job.items[0]
    _fail_item(
        database,
        item.id,
        attempt_status="request_failed",
        response_content='{"error":"upstream unavailable"}',
    )

    repository = AssetRepository(database)
    failed_items, failed_total, status_counts = repository.list_assets(annotation_status="failed")
    review_items, review_total, _ = repository.list_assets(annotation_status="needs_review")

    assert failed_total == 1
    assert [asset.id for asset in failed_items] == [item.asset_id]
    assert failed_items[0].annotation_status.value == "missing"
    assert failed_items[0].generation_status == "failed"
    assert failed_items[0].generation_error == "simulated failure"
    assert review_total == 1
    assert [asset.id for asset in review_items] == [item.asset_id]
    assert repository.list_asset_ids(annotation_status="needs_review") == [item.asset_id]
    assert status_counts["failed"] == 1
    assert status_counts["needs_review"] == 1
    assert repository.count_summary() == (1, 0, 1)

    jobs.retry_failed(project_id, job.id)

    _, failed_total_after_retry, status_counts_after_retry = repository.list_assets(
        annotation_status="failed"
    )
    assert failed_total_after_retry == 0
    assert status_counts_after_retry["failed"] == 0
    assert status_counts_after_retry["needs_review"] == 0
    assert repository.list_asset_ids(annotation_status="needs_review") == []
    assert repository.count_summary() == (1, 0, 0)
