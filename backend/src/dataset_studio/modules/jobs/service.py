from __future__ import annotations

import json
import uuid

from dataset_studio.core.errors import JobNotFoundError
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import (
    ActiveJobsOverview,
    JobCreateRequest,
    JobDetail,
    JobScope,
    JobSummary,
)
from dataset_studio.modules.jobs.query_repository import JobQueryRepository
from dataset_studio.modules.jobs.repository import JobCreationRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.workspaces.service import WorkspaceService


class JobService:
    def __init__(
        self,
        workspaces: WorkspaceService,
        presets: PresetService,
        annotations: AnnotationService,
    ) -> None:
        self._workspaces = workspaces
        self._presets = presets
        self._annotations = annotations

    def create(self, project_id: str, request: JobCreateRequest) -> JobDetail:
        paths, manifest = self._workspaces.get(project_id)
        system_preset = self._presets.get_system(request.system_preset_id)
        provider_profile = self._presets.get_provider(request.provider_profile_id)
        self._presets.get_api_key(provider_profile.id)
        asset_ids = self._select_assets(
            paths.database,
            request.scope,
            request.asset_ids,
            overwrite_existing=request.overwrite_existing,
        )
        if not asset_ids:
            raise ValueError("当前范围内没有需要标注的图片；已有同名 TXT 会被自动跳过。")

        job_id = str(uuid.uuid4())
        repository = JobCreationRepository(paths.database)
        repository.insert_job(
            job_id=job_id,
            system_preset_id=system_preset.id,
            system_prompt_snapshot=system_preset.model_dump_json(),
            provider_profile_id=provider_profile.id,
            provider_snapshot=provider_profile.model_dump_json(),
            user_prompt_snapshot=manifest.settings.user_prompt,
            json_fields_snapshot=json.dumps(manifest.settings.json_fields, ensure_ascii=False),
            scope=request.scope.value,
            overwrite_existing=request.overwrite_existing,
            retry_limit=3,
            asset_ids=asset_ids,
        )
        return self.get(project_id, job_id)

    def list(self, project_id: str) -> list[JobSummary]:
        paths, _ = self._workspaces.get(project_id)
        return JobQueryRepository(paths.database).list_jobs()

    def get(self, project_id: str, job_id: str) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        job = JobQueryRepository(paths.database).get_job(job_id)
        if job is None:
            raise JobNotFoundError(f"找不到任务：{job_id}")
        return job

    def stop(self, project_id: str, job_id: str) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        repository = JobLifecycleRepository(paths.database)
        if not repository.request_stop(job_id):
            raise JobNotFoundError("任务不存在或已经结束。")
        return self.get(project_id, job_id)

    def stop_all(self, project_id: str) -> int:
        paths, _ = self._workspaces.get(project_id)
        return JobLifecycleRepository(paths.database).request_stop_all()

    def active_overview(self) -> ActiveJobsOverview:
        count = 0
        project_count = 0
        for workspace in self._workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._workspaces.get(workspace.project_id)
            active_count = JobLifecycleRepository(paths.database).active_count()
            if active_count:
                project_count += 1
                count += active_count
        return ActiveJobsOverview(count=count, project_count=project_count)

    def stop_all_workspaces(self) -> int:
        stopped = 0
        for workspace in self._workspaces.list_recent():
            if workspace.exists:
                paths, _ = self._workspaces.get(workspace.project_id)
                stopped += JobLifecycleRepository(paths.database).request_stop_all()
        return stopped

    def resume(self, project_id: str, job_id: str) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        if not JobLifecycleRepository(paths.database).resume(job_id):
            raise JobNotFoundError(f"找不到任务：{job_id}")
        return self.get(project_id, job_id)

    def retry_failed(self, project_id: str, job_id: str) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        if not JobLifecycleRepository(paths.database).resume(job_id, failed_only=True):
            raise JobNotFoundError(f"找不到任务：{job_id}")
        return self.get(project_id, job_id)

    def manually_accept(self, project_id: str, job_id: str, item_id: str) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        queries = JobQueryRepository(paths.database)
        execution = JobExecutionRepository(paths.database)
        job = queries.get_job_row(job_id)
        if job is None:
            raise JobNotFoundError(f"找不到任务：{job_id}")
        response = queries.latest_failed_response(job_id, item_id)
        if response is None:
            raise ValueError("这个失败项没有可以人工采用的模型响应。")
        asset_id, content = response
        self._annotations.save_generated(project_id, asset_id, content, manually_accepted=True)
        from dataset_studio.modules.jobs.models import JobItemStatus

        execution.finish_item(
            item_id,
            JobItemStatus.MANUALLY_ACCEPTED,
            validation_status="manually_accepted",
            manually_accepted=True,
        )
        JobLifecycleRepository(paths.database).finalize_jobs()
        return self.get(project_id, job_id)

    @staticmethod
    def _select_assets(
        database_path,
        scope: JobScope,
        selected_ids: list[str],
        *,
        overwrite_existing: bool,
    ) -> list[str]:
        clauses = ["is_present = 1"]
        parameters: list[object] = []
        if not overwrite_existing:
            clauses.append("annotation_status = 'missing'")
        if scope == JobScope.SELECTED:
            if not selected_ids:
                return []
            placeholders = ",".join("?" for _ in selected_ids)
            clauses.append(f"id IN ({placeholders})")
            parameters.extend(selected_ids)
        connection = connect(database_path)
        try:
            rows = connection.execute(
                f"SELECT id FROM assets WHERE {' AND '.join(clauses)} ORDER BY relative_path",
                parameters,
            ).fetchall()
            return [str(row["id"]) for row in rows]
        finally:
            connection.close()
