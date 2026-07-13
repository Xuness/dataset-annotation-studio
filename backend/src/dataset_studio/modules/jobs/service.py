from __future__ import annotations

import json
import uuid

from dataset_studio.core.errors import JobNotFoundError, PresetNotFoundError
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import (
    ActiveJobsOverview,
    JobCreateRequest,
    JobDetail,
    JobItemStatus,
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

    def create(
        self,
        project_id: str,
        request: JobCreateRequest,
        *,
        include_items: bool = True,
    ) -> JobDetail:
        paths, manifest = self._workspaces.get(project_id)
        system_preset_id = manifest.settings.system_preset_id
        if not system_preset_id:
            raise ValueError("请先在素材页的提示词面板选择并保存 System Prompt 预设。")
        try:
            system_preset = self._presets.get_system(system_preset_id)
        except PresetNotFoundError as error:
            raise ValueError(
                "项目关联的 System Prompt 预设已不存在，请在素材页重新选择并保存。"
            ) from error
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
        return self.get(project_id, job_id, include_items=include_items)

    def list(
        self,
        project_id: str,
        *,
        offset: int = 0,
        limit: int = 100,
        active_only: bool = False,
    ) -> list[JobSummary]:
        paths, _ = self._workspaces.get(project_id)
        return JobQueryRepository(paths.database).list_jobs(
            offset=offset,
            limit=limit,
            active_only=active_only,
        )

    def get(
        self,
        project_id: str,
        job_id: str,
        *,
        include_items: bool = True,
        failed_items_only: bool = False,
        item_offset: int = 0,
        item_limit: int | None = None,
    ) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        job = JobQueryRepository(paths.database).get_job(
            job_id,
            include_items=include_items,
            failed_items_only=failed_items_only,
            item_offset=item_offset,
            item_limit=item_limit,
        )
        if job is None:
            raise JobNotFoundError(f"找不到任务：{job_id}")
        return job

    def stop(self, project_id: str, job_id: str, *, include_items: bool = True) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        repository = JobLifecycleRepository(paths.database)
        if not repository.request_stop(job_id):
            raise JobNotFoundError("任务不存在或已经结束。")
        return self.get(project_id, job_id, include_items=include_items)

    def stop_all(self, project_id: str) -> int:
        paths, _ = self._workspaces.get(project_id)
        return JobLifecycleRepository(paths.database).request_stop_all()

    def has_active(self, project_id: str) -> bool:
        paths, _ = self._workspaces.get(project_id)
        return JobLifecycleRepository(paths.database).active_count() > 0

    def active_overview(self) -> ActiveJobsOverview:
        count = 0
        projects = self.active_project_ids()
        for project_id in projects:
            paths, _ = self._workspaces.get(project_id)
            count += JobLifecycleRepository(paths.database).active_count()
        return ActiveJobsOverview(
            count=count,
            project_count=len(projects),
            annotation_job_count=count,
        )

    def active_project_ids(self) -> set[str]:
        projects: set[str] = set()
        for workspace in self._workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._workspaces.get(workspace.project_id)
            if JobLifecycleRepository(paths.database).active_count():
                projects.add(workspace.project_id)
        return projects

    def stop_all_workspaces(self) -> int:
        stopped = 0
        for workspace in self._workspaces.list_recent():
            if workspace.exists:
                paths, _ = self._workspaces.get(workspace.project_id)
                stopped += JobLifecycleRepository(paths.database).request_stop_all()
        return stopped

    def resume(self, project_id: str, job_id: str, *, include_items: bool = True) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        if JobQueryRepository(paths.database).get_job_row(job_id) is None:
            raise JobNotFoundError(f"找不到任务：{job_id}")
        if not JobLifecycleRepository(paths.database).resume(job_id):
            raise ValueError("只有已停止或意外中断的任务可以继续。")
        return self.get(project_id, job_id, include_items=include_items)

    def retry_failed(
        self,
        project_id: str,
        job_id: str,
        *,
        include_items: bool = True,
    ) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        if JobQueryRepository(paths.database).get_job_row(job_id) is None:
            raise JobNotFoundError(f"找不到任务：{job_id}")
        if not JobLifecycleRepository(paths.database).resume(job_id, failed_only=True):
            raise ValueError("只有已经结束且仍含失败项的任务可以仅重试失败项。")
        return self.get(project_id, job_id, include_items=include_items)

    def manually_accept(
        self,
        project_id: str,
        job_id: str,
        item_id: str,
        *,
        include_items: bool = True,
    ) -> JobDetail:
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
        execution.finish_item(
            item_id,
            JobItemStatus.MANUALLY_ACCEPTED,
            validation_status="manually_accepted",
            manually_accepted=True,
        )
        JobLifecycleRepository(paths.database).finalize_job(job_id)
        return self.get(project_id, job_id, include_items=include_items)

    @staticmethod
    def _select_assets(
        database_path,
        scope: JobScope,
        selected_ids: list[str],
        *,
        overwrite_existing: bool,
    ) -> list[str]:
        if scope == JobScope.SELECTED:
            if not selected_ids:
                return []
            unique_ids = list(dict.fromkeys(selected_ids))
        else:
            unique_ids = []
        connection = connect(database_path)
        try:
            clauses = ["is_present = 1"]
            if not overwrite_existing:
                clauses.append("annotation_status = 'missing'")
            if not unique_ids:
                rows = connection.execute(
                    f"""
                    SELECT id, relative_path FROM assets
                    WHERE {" AND ".join(clauses)}
                    ORDER BY relative_path
                    """
                ).fetchall()
            else:
                rows = []
                for start in range(0, len(unique_ids), 500):
                    batch = unique_ids[start : start + 500]
                    placeholders = ",".join("?" for _ in batch)
                    rows.extend(
                        connection.execute(
                            f"""
                            SELECT id, relative_path FROM assets
                            WHERE {" AND ".join(clauses)} AND id IN ({placeholders})
                            """,
                            batch,
                        ).fetchall()
                    )
                rows.sort(key=lambda row: str(row["relative_path"]).casefold())
            return [str(row["id"]) for row in rows]
        finally:
            connection.close()
