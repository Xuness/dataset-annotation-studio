from __future__ import annotations

import json
import uuid
from pathlib import Path

from dataset_studio.core.errors import JobNotFoundError, PresetNotFoundError
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import (
    ActiveJobsOverview,
    ExistingTranslationPolicy,
    JobCreateRequest,
    JobDetail,
    JobItemStatus,
    JobKind,
    JobScope,
    JobSummary,
)
from dataset_studio.modules.jobs.query_repository import JobQueryRepository
from dataset_studio.modules.jobs.repository import JobCreationRepository
from dataset_studio.modules.presets.models import TranslationPromptPreset
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.translations.prompt import (
    DEFAULT_TRANSLATION_PROMPT_PRESET_ID,
    render_translation_system_prompt,
)
from dataset_studio.modules.translations.service import TranslationService
from dataset_studio.modules.workspaces.service import WorkspaceService


class JobService:
    def __init__(
        self,
        workspaces: WorkspaceService,
        presets: PresetService,
        annotations: AnnotationService,
        translations: TranslationService | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._presets = presets
        self._annotations = annotations
        self._translations = translations or TranslationService(workspaces)

    def create(
        self,
        project_id: str,
        request: JobCreateRequest,
        *,
        include_items: bool = True,
    ) -> JobDetail:
        paths, manifest = self._workspaces.get(project_id)
        provider_profile = self._presets.get_provider(request.provider_profile_id)
        self._presets.get_provider_credential(provider_profile)
        selected_model = request.model.strip() if request.model else provider_profile.model
        if selected_model not in provider_profile.models:
            raise ValueError(
                f"模型“{selected_model}”不在 API 配置“{provider_profile.name}”的模型列表中。"
            )
        provider_snapshot = provider_profile.model_copy(update={"model": selected_model})

        if request.kind == JobKind.TRANSLATION:
            language = self._translations.normalize_language(request.target_language)
            translation_prompt = self._resolve_translation_prompt(
                request.translation_prompt_preset_id
            )
            system_preset_id = translation_prompt.id
            system_prompt = render_translation_system_prompt(
                translation_prompt.system_prompt,
                language,
            )
            system_prompt_snapshot = json.dumps(
                {
                    "id": system_preset_id,
                    "name": translation_prompt.name,
                    "system_prompt": system_prompt,
                    "system_prompt_template": translation_prompt.system_prompt,
                    "created_at": translation_prompt.created_at,
                    "updated_at": translation_prompt.updated_at,
                },
                ensure_ascii=False,
            )
            configuration = {
                "target_language": language,
                "translation_policy": request.translation_policy.value,
                "translation_prompt_preset_id": translation_prompt.id,
            }
            asset_ids = self._select_translation_assets(
                paths.database,
                paths.root,
                request.scope,
                request.asset_ids,
                language=language,
                policy=request.translation_policy,
            )
            if not asset_ids:
                raise ValueError("当前范围内没有符合策略且带有源标注的素材可翻译。")
            user_prompt_snapshot = ""
            json_fields_snapshot = "[]"
            overwrite_existing = request.translation_policy == ExistingTranslationPolicy.OVERWRITE
        else:
            system_preset_id = manifest.settings.system_preset_id
            if not system_preset_id:
                raise ValueError("请先在素材页的提示词面板选择并保存 System Prompt 预设。")
            try:
                system_preset = self._presets.get_system(system_preset_id)
            except PresetNotFoundError as error:
                raise ValueError(
                    "项目关联的 System Prompt 预设已不存在，请在素材页重新选择并保存。"
                ) from error
            system_prompt_snapshot = system_preset.model_dump_json()
            configuration = {}
            asset_ids = self._select_annotation_assets(
                paths.database,
                request.scope,
                request.asset_ids,
                overwrite_existing=request.overwrite_existing,
            )
            if not asset_ids:
                raise ValueError("当前范围内没有需要标注的图片；已有同名 TXT 会被自动跳过。")
            user_prompt_snapshot = manifest.settings.user_prompt
            json_fields_snapshot = json.dumps(
                manifest.settings.json_fields,
                ensure_ascii=False,
            )
            overwrite_existing = request.overwrite_existing

        job_id = str(uuid.uuid4())
        repository = JobCreationRepository(paths.database)
        repository.insert_job(
            job_id=job_id,
            kind=request.kind.value,
            configuration_snapshot=json.dumps(configuration, ensure_ascii=False),
            system_preset_id=system_preset_id,
            system_prompt_snapshot=system_prompt_snapshot,
            provider_profile_id=provider_profile.id,
            provider_snapshot=provider_snapshot.model_dump_json(),
            user_prompt_snapshot=user_prompt_snapshot,
            json_fields_snapshot=json_fields_snapshot,
            scope=request.scope.value,
            overwrite_existing=overwrite_existing,
            retry_limit=3,
            asset_ids=asset_ids,
        )
        return self.get(project_id, job_id, include_items=include_items)

    def _resolve_translation_prompt(
        self,
        preset_id: str | None,
    ) -> TranslationPromptPreset:
        if preset_id:
            try:
                return self._presets.get_translation_prompt(preset_id)
            except PresetNotFoundError as error:
                raise ValueError("选择的翻译 Prompt 预设已不存在，请重新选择。") from error

        presets = self._presets.list_translation_prompts()
        if not presets:
            raise ValueError("请先在预设页创建翻译 Prompt 预设。")
        return next(
            (preset for preset in presets if preset.id == DEFAULT_TRANSLATION_PROMPT_PRESET_ID),
            presets[0],
        )

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
        annotation_count = 0
        translation_count = 0
        projects = self.active_project_ids()
        for project_id in projects:
            paths, _ = self._workspaces.get(project_id)
            connection = connect(paths.database)
            try:
                rows = connection.execute(
                    """
                    SELECT kind, COUNT(*) AS count
                    FROM jobs
                    WHERE status IN ('queued', 'running', 'stopping')
                    GROUP BY kind
                    """
                ).fetchall()
            finally:
                connection.close()
            for row in rows:
                item_count = int(row["count"])
                count += item_count
                if str(row["kind"]) == JobKind.TRANSLATION.value:
                    translation_count += item_count
                else:
                    annotation_count += item_count
        return ActiveJobsOverview(
            count=count,
            project_count=len(projects),
            annotation_job_count=annotation_count,
            translation_job_count=translation_count,
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
        asset_id, content, source_hash = response
        if str(job["kind"]) == JobKind.TRANSLATION.value:
            configuration = json.loads(str(job["configuration_snapshot"]))
            if not source_hash:
                raise ValueError("这个译文响应缺少对应的源标注版本，无法安全采用。")
            profile = json.loads(str(job["provider_snapshot"]))
            self._translations.save_generated(
                project_id,
                asset_id,
                str(configuration["target_language"]),
                content,
                expected_source_hash=source_hash,
                provider_profile_id=str(job["provider_profile_id"]),
                provider_profile_name=str(profile.get("name", "")) or None,
                model=str(profile.get("model", "")) or None,
                manually_accepted=True,
            )
        else:
            self._annotations.save_generated(
                project_id,
                asset_id,
                content,
                manually_accepted=True,
            )
        execution.finish_item(
            item_id,
            JobItemStatus.MANUALLY_ACCEPTED,
            validation_status="manually_accepted",
            manually_accepted=True,
        )
        JobLifecycleRepository(paths.database).finalize_job(job_id)
        return self.get(project_id, job_id, include_items=include_items)

    @staticmethod
    def _select_annotation_assets(
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

    @staticmethod
    def _select_translation_assets(
        database_path: Path,
        workspace_root: Path,
        scope: JobScope,
        selected_ids: list[str],
        *,
        language: str,
        policy: ExistingTranslationPolicy,
    ) -> list[str]:
        unique_ids = list(dict.fromkeys(selected_ids)) if scope == JobScope.SELECTED else []
        if scope == JobScope.SELECTED and not unique_ids:
            return []

        connection = connect(database_path)
        try:
            parameters: list[object] = []
            selected_clause = ""
            if unique_ids:
                placeholders = ",".join("?" for _ in unique_ids)
                selected_clause = f"AND a.id IN ({placeholders})"
                parameters.extend(unique_ids)
            rows = connection.execute(
                f"""
                SELECT a.id, a.relative_path, a.annotation_relative_path,
                       t.source_annotation_hash
                FROM assets a
                LEFT JOIN annotation_translations t
                  ON t.asset_id = a.id AND t.language = ?
                WHERE a.is_present = 1
                  AND a.annotation_status != 'missing'
                  {selected_clause}
                ORDER BY a.relative_path COLLATE NOCASE
                """,
                [language, *parameters],
            ).fetchall()
            annotation_owners = {
                str(owner["annotation_relative_path"]).casefold(): str(owner["id"])
                for owner in connection.execute(
                    """
                    SELECT id, annotation_relative_path
                    FROM assets
                    WHERE is_present = 1
                    """
                )
            }
        finally:
            connection.close()

        selected: list[str] = []
        root = workspace_root.resolve()
        for row in rows:
            annotation_path = (root / str(row["annotation_relative_path"])).resolve()
            if not annotation_path.is_relative_to(root) or not annotation_path.is_file():
                continue
            translation_path = annotation_path.with_name(f"{annotation_path.stem}.{language}.txt")
            translation_relative_path = translation_path.relative_to(root).as_posix()
            owner_id = annotation_owners.get(translation_relative_path.casefold())
            if owner_id is not None and owner_id != str(row["id"]):
                continue
            if policy == ExistingTranslationPolicy.OVERWRITE:
                selected.append(str(row["id"]))
                continue
            if not translation_path.is_file():
                selected.append(str(row["id"]))
                continue
            if policy == ExistingTranslationPolicy.SKIP:
                continue
            recorded_hash = row["source_annotation_hash"]
            if recorded_hash is None:
                selected.append(str(row["id"]))
                continue
            source_content = annotation_path.read_text(encoding="utf-8", errors="replace")
            if str(recorded_hash) != TranslationService.content_hash(source_content):
                selected.append(str(row["id"]))
        return selected
