from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dataset_studio.api.app import create_app
from dataset_studio.core.config import Settings
from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
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
from dataset_studio.modules.jobs.output_resources import job_output_resource_key
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
    recover_stale_operation_leases,
)
from dataset_studio.modules.presets.models import (
    ProviderProfileCreate,
    SystemPresetCreate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.config import (
    OpenAICompatibleModelOptions,
    OpenRouterModelOptions,
    ProviderModelConfig,
    ProviderType,
)
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


def _single_item_job(
    tmp_path: Path,
    *,
    extra_assets: int = 0,
    use_tags_as_context: bool = False,
):
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
    for index in range(extra_assets):
        Image.new("RGB", (32, 32), "white").save(project / f"sample-{index:03d}.png")
    workspace, _ = workspaces.open(str(project))
    system = presets.create_system(
        SystemPresetCreate(name="XML", system_prompt="Return balanced tags.")
    )
    workspaces.update_settings(
        workspace.project_id,
        WorkspaceSettingsUpdate(
            system_preset_id=system.id,
            use_tags_as_context=use_tags_as_context,
        ),
    )
    paths, _ = workspaces.get(workspace.project_id)
    if use_tags_as_context:
        connection = connect(paths.database)
        try:
            asset_id = str(
                connection.execute(
                    "SELECT id FROM assets ORDER BY relative_path LIMIT 1"
                ).fetchone()["id"]
            )
        finally:
            connection.close()
        annotations.save_tags(
            workspace.project_id,
            asset_id,
            [AnnotationTag(name="blue_hair", origin="manual")],
        )
    provider = presets.create_provider(
        ProviderProfileCreate(
            name="Provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            default_model_id="example/model",
            models=[
                ProviderModelConfig(
                    model_id="example/model",
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
        ),
    )
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


def test_asset_related_jobs_preserve_job_and_item_identity(tmp_path: Path) -> None:
    jobs, project_id, job, _database, _project = _single_item_job(tmp_path)
    item = job.items[0]

    records = jobs.list_for_asset(project_id, item.asset_id)

    assert len(records) == 1
    assert records[0].job.id == job.id
    assert records[0].item_id == item.id
    assert records[0].item_status == JobItemStatus.PENDING
    assert records[0].attempt_count == 0
    assert records[0].result_disposition == "none"


def test_orphan_recovery_finishes_running_attempt(tmp_path: Path) -> None:
    _, _, job, database, _ = _single_item_job(tmp_path)
    execution = JobExecutionRepository(database)
    claimed = execution.claim_items(job.id, 1)
    assert len(claimed) == 1
    attempt_id, _ = execution.start_attempt(str(claimed[0]["id"]))

    assert JobLifecycleRepository(database).recover_orphaned() == 1

    connection = connect(database)
    try:
        attempt = connection.execute(
            "SELECT status, error_message, finished_at FROM job_attempts WHERE id = ?",
            (attempt_id,),
        ).fetchone()
    finally:
        connection.close()
    assert attempt["status"] == "interrupted"
    assert "应用在请求完成前退出" in attempt["error_message"]
    assert attempt["finished_at"] is not None


def test_job_recovery_does_not_delete_a_live_foreground_output_lease(
    tmp_path: Path,
) -> None:
    _, _, _, database, _ = _single_item_job(tmp_path)
    resource_key = annotation_document_resource_key(
        "foreground-asset",
        AnnotationChannel.DESCRIPTION.value,
    )
    with hold_output_resources(database, [OutputResourceClaim(resource_key)]):
        assert JobLifecycleRepository(database).recover_orphaned() == 0
        assert recover_stale_operation_leases(database) == 0
        connection = connect(database)
        try:
            lease = connection.execute(
                """
                SELECT operation_id, owner_role, owner_instance_id
                FROM output_resource_leases
                WHERE resource_key = ?
                """,
                (resource_key,),
            ).fetchone()
        finally:
            connection.close()
        assert lease is not None
        assert lease["operation_id"]
        assert lease["owner_role"]
        assert lease["owner_instance_id"]


def test_output_lease_serializes_jobs_targeting_the_same_file(tmp_path: Path) -> None:
    jobs, project_id, first_job, database, _ = _single_item_job(tmp_path)
    second_job = jobs.create(
        project_id,
        JobCreateRequest(
            provider_profile_id=first_job.provider_profile_id,
            scope=JobScope.ALL,
        ),
    )
    execution = JobExecutionRepository(database)

    first_claim = execution.claim_items(first_job.id, 1)
    assert len(first_claim) == 1
    assert execution.claim_items(second_job.id, 1) == []

    connection = connect(database)
    try:
        lease_count = connection.execute("SELECT COUNT(*) FROM output_resource_leases").fetchone()[
            0
        ]
    finally:
        connection.close()
    assert lease_count == 1

    execution.finish_item(str(first_claim[0]["id"]), JobItemStatus.SKIPPED)
    second_claim = execution.claim_items(second_job.id, 1)
    assert len(second_claim) == 1


def test_output_claim_pages_past_resources_held_by_another_job(tmp_path: Path) -> None:
    jobs, project_id, first_job, database, _ = _single_item_job(
        tmp_path,
        extra_assets=64,
    )
    second_job = jobs.create(
        project_id,
        JobCreateRequest(
            provider_profile_id=first_job.provider_profile_id,
            scope=JobScope.ALL,
        ),
    )
    execution = JobExecutionRepository(database)

    assert len(execution.claim_items(first_job.id, 64)) == 64
    second_claim = execution.claim_items(second_job.id, 1)

    assert len(second_claim) == 1
    assert second_claim[0]["relative_path"] == "sample.png"


def test_job_output_resource_keys_are_database_channel_specific() -> None:
    translation_key = job_output_resource_key(
        "translation",
        '{"target_language":"zh-cn"}',
        "asset",
        "translation",
    )
    description_key = job_output_resource_key("annotation", "{}", "asset", "description")
    tags_key = job_output_resource_key("annotation", "{}", "asset", "tags")

    assert translation_key == annotation_document_resource_key(
        "asset",
        "translation",
        "zh-CN",
    )
    assert description_key != tags_key


def test_scan_api_refuses_to_run_while_job_is_active(tmp_path: Path) -> None:
    _, project_id, _, _, _ = _single_item_job(tmp_path)
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        opened = client.post(
            "/api/v1/workspaces/open",
            json={"path": str(tmp_path / "dataset")},
        )
        response = client.post(f"/api/v1/workspaces/{project_id}/scan")

    assert opened.status_code == 200
    assert opened.json()["scan"]["scanned_files"] == 0
    assert response.status_code == 400
    assert "任务运行" in response.json()["detail"]


def test_remove_recent_api_refuses_while_job_is_active(tmp_path: Path) -> None:
    _, project_id, _, _, project = _single_item_job(tmp_path)
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)

    with TestClient(create_app(settings)) as client:
        client.post(
            "/api/v1/workspaces/open",
            json={"path": str(project)},
        )
        response = client.delete(f"/api/v1/workspaces/{project_id}/recent")
        recent = client.get("/api/v1/workspaces").json()

    assert response.status_code == 400
    assert "任务运行" in response.json()["detail"]
    assert [workspace["project_id"] for workspace in recent] == [project_id]
    assert (project / "sample.png").is_file()


def test_job_creation_targets_description_independently_and_snapshots_presets(
    tmp_path: Path,
) -> None:
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
            default_model_id="example/model",
            models=[
                ProviderModelConfig(
                    model_id="example/model",
                    temperature=0.2,
                    protocol_options=OpenRouterModelOptions(),
                ),
                ProviderModelConfig(
                    model_id="example/alternate",
                    temperature=0.8,
                    protocol_options=OpenRouterModelOptions(),
                ),
            ],
            api_key="secret",
        )
    )

    job = jobs.create(
        workspace.project_id,
        JobCreateRequest(
            provider_profile_id=provider.id,
            model_id="example/alternate",
            scope=JobScope.ALL,
        ),
    )

    assert job.total == 2
    assert [item.relative_path for item in job.items] == ["already.png", "pending.png"]
    assert job.output_channel.value == "description"
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
                model_id="unknown/model",
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
            default_model_id="example/model",
            models=[
                ProviderModelConfig(
                    model_id="example/model",
                    protocol_options=OpenAICompatibleModelOptions(),
                )
            ],
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

    assert not (project / "sample.txt").exists()
    connection = connect(database)
    try:
        stored = connection.execute(
            """
            SELECT t.content, d.channel, d.reviewed_revision_id, d.head_revision_id
            FROM annotation_documents d
            JOIN annotation_text_contents t ON t.revision_id = d.head_revision_id
            WHERE d.asset_id = ? AND d.channel = 'description'
            """,
            (item.asset_id,),
        ).fetchone()
    finally:
        connection.close()
    assert stored is not None
    assert str(stored["content"]) == invalid_response
    assert stored["reviewed_revision_id"] == stored["head_revision_id"]
    assert accepted.status == JobStatus.COMPLETED
    assert accepted.manually_accepted == 1
    assert accepted.failed == 0
    assert accepted.items[0].status == JobItemStatus.MANUALLY_ACCEPTED


def test_manual_accept_preserves_frozen_tag_dependency(tmp_path: Path) -> None:
    jobs, project_id, job, database, _ = _single_item_job(
        tmp_path,
        use_tags_as_context=True,
    )
    item = job.items[0]
    _fail_item(
        database,
        item.id,
        attempt_status="validation_failed",
        response_content="<caption>accepted with frozen tags",
    )

    jobs.manually_accept(project_id, job.id, item.id)

    connection = connect(database)
    try:
        dependency = connection.execute(
            """
            SELECT dependency.input_revision_id, dependency.role,
                   frozen.revision_id AS frozen_revision_id
            FROM annotation_documents description
            JOIN annotation_revision_inputs dependency
              ON dependency.output_revision_id = description.head_revision_id
            JOIN job_item_annotation_inputs frozen
              ON frozen.job_item_id = ?
             AND frozen.role = 'tag_context'
            WHERE description.asset_id = ?
              AND description.channel = 'description'
            """,
            (item.id, item.asset_id),
        ).fetchone()
    finally:
        connection.close()

    assert dependency is not None
    assert dependency["role"] == "tag_context"
    assert dependency["input_revision_id"] == dependency["frozen_revision_id"]


def test_manual_accept_does_not_overwrite_a_newer_annotation(tmp_path: Path) -> None:
    jobs, project_id, job, database, _ = _single_item_job(tmp_path)
    item = job.items[0]
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    workspaces = WorkspaceService(
        settings,
        WorkspaceRegistry(settings.app_data_dir / "global.sqlite3"),
    )
    annotations = AnnotationService(workspaces)
    annotations.save_text(
        project_id,
        item.asset_id,
        AnnotationChannel.DESCRIPTION,
        "<caption>new manual edit</caption>",
        expected_head_revision_id=None,
        review=True,
    )
    _fail_item(
        database,
        item.id,
        attempt_status="validation_failed",
        response_content="<caption>stale model response",
    )

    with pytest.raises(ResourceConflictError, match="版本已经变化"):
        jobs.manually_accept(project_id, job.id, item.id)

    current = annotations.get_channel(
        project_id,
        item.asset_id,
        AnnotationChannel.DESCRIPTION,
    )
    assert current.content == "<caption>new manual edit</caption>"
    assert current.review_status.value == "reviewed"
    failed = jobs.get(project_id, job.id)
    assert failed.status == JobStatus.COMPLETED_WITH_ERRORS
    assert failed.manually_accepted == 0


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


def test_translation_failure_appears_in_database_review_queue(tmp_path: Path) -> None:
    _, _, job, database, _ = _single_item_job(tmp_path)
    item = job.items[0]
    connection = connect(database)
    try:
        connection.execute(
            """
            UPDATE jobs
            SET kind = 'translation',
                configuration_snapshot = '{"target_language":"zh-CN"}',
                output_channel = 'translation'
            WHERE id = ?
            """,
            (job.id,),
        )
        connection.commit()
    finally:
        connection.close()
    _fail_item(
        database,
        item.id,
        attempt_status="request_failed",
        response_content='{"error":"translation unavailable"}',
    )

    repository = AssetRepository(database)

    assert repository.list_asset_ids(annotation_status="failed") == [item.asset_id]
    assert repository.list_asset_ids(annotation_status="needs_review") == [item.asset_id]


def test_success_in_another_channel_does_not_hide_generation_failure(tmp_path: Path) -> None:
    _, _, job, database, _ = _single_item_job(tmp_path)
    item = job.items[0]
    _fail_item(
        database,
        item.id,
        attempt_status="request_failed",
        response_content='{"error":"description unavailable"}',
    )
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO jobs (
                id, status, system_preset_id, system_prompt_snapshot,
                provider_profile_id, provider_snapshot, user_prompt_snapshot,
                json_fields_snapshot, scope, created_at, updated_at,
                kind, configuration_snapshot, execution_backend,
                execution_profile_id, execution_snapshot, output_channel
            ) VALUES (
                'later-job', 'completed', 'tagger', '{}',
                '', '{}', '', '[]', 'all',
                '9999-01-01T00:00:00Z', '9999-01-01T00:00:00Z',
                'annotation', '{}', 'local_tagger',
                'tagger-profile', '{}', 'tags'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO job_items (
                id, job_id, asset_id, status, created_at, updated_at
            ) VALUES (
                'later-item', 'later-job', ?, 'succeeded',
                '9999-01-01T00:00:00Z', '9999-01-01T00:00:00Z'
            )
            """,
            (item.asset_id,),
        )
        connection.commit()
    finally:
        connection.close()

    repository = AssetRepository(database)
    assert repository.list_asset_ids(annotation_status="failed") == [item.asset_id]

    connection = connect(database)
    try:
        connection.execute("UPDATE jobs SET output_channel = 'description' WHERE id = 'later-job'")
        connection.commit()
    finally:
        connection.close()

    assert repository.list_asset_ids(annotation_status="failed") == []
