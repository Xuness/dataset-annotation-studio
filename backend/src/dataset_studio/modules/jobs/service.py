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
    ExecutionBackend,
    ExistingTranslationPolicy,
    JobCreateRequest,
    JobDetail,
    JobItemStatus,
    JobKind,
    JobScope,
    JobSummary,
)
from dataset_studio.modules.jobs.provider_snapshot import load_provider_snapshot
from dataset_studio.modules.jobs.query_repository import JobQueryRepository
from dataset_studio.modules.jobs.repository import JobCreationRepository
from dataset_studio.modules.presets.models import TranslationPromptPreset
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.taggers.service import TaggerService
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
        taggers: TaggerService | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._presets = presets
        self._annotations = annotations
        self._translations = translations or TranslationService(workspaces)
        self._taggers = taggers

    def create(
        self,
        project_id: str,
        request: JobCreateRequest,
        *,
        include_items: bool = True,
    ) -> JobDetail:
        if request.execution_backend == ExecutionBackend.LOCAL_TAGGER:
            if self._taggers is None:
                raise ValueError("当前本地服务没有启用本地打标器模块。")
            with self._taggers.catalog_guard():
                return self._create(project_id, request, include_items=include_items)
        return self._create(project_id, request, include_items=include_items)

    def _create(
        self,
        project_id: str,
        request: JobCreateRequest,
        *,
        include_items: bool,
    ) -> JobDetail:
        paths, manifest = self._workspaces.get(project_id)
        if request.execution_backend == ExecutionBackend.LOCAL_TAGGER:
            assert self._taggers is not None
            assert request.tagger_profile_id is not None
            local_snapshot = self._taggers.resolve_execution_profile(request.tagger_profile_id)
            execution_profile_id = local_snapshot.id
            execution_snapshot = local_snapshot.model_dump_json()
            provider_profile_id = ""
            provider_snapshot_json = "{}"
            system_preset_id = ""
            system_prompt_snapshot = json.dumps(
                {
                    "id": "",
                    "name": "本地打标器",
                    "system_prompt": "",
                },
                ensure_ascii=False,
            )
            configuration = {"tagger_profile_id": local_snapshot.id}
            asset_ids = self._select_annotation_assets(
                paths.database,
                request.scope,
                request.asset_ids,
                overwrite_existing=request.overwrite_existing,
            )
            if not asset_ids:
                raise ValueError("当前范围内没有需要标注的图片；已有同名 TXT 会被自动跳过。")
            user_prompt_snapshot = ""
            json_fields_snapshot = "[]"
            overwrite_existing = request.overwrite_existing
            retry_limit = 0
        else:
            assert request.provider_profile_id is not None
            provider_profile = self._presets.get_provider(request.provider_profile_id)
            self._presets.get_provider_credential(provider_profile)
            provider_snapshot = self._presets.resolve_execution_profile(
                provider_profile,
                request.model_id,
            )
            execution_profile_id = provider_snapshot.id
            execution_snapshot = provider_snapshot.model_dump_json()
            provider_profile_id = provider_profile.id
            provider_snapshot_json = execution_snapshot
            retry_limit = 3

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
                overwrite_existing = (
                    request.translation_policy == ExistingTranslationPolicy.OVERWRITE
                )
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
            execution_backend=request.execution_backend.value,
            execution_profile_id=execution_profile_id,
            execution_snapshot=execution_snapshot,
            system_preset_id=system_preset_id,
            system_prompt_snapshot=system_prompt_snapshot,
            provider_profile_id=provider_profile_id,
            provider_snapshot=provider_snapshot_json,
            user_prompt_snapshot=user_prompt_snapshot,
            json_fields_snapshot=json_fields_snapshot,
            scope=request.scope.value,
            overwrite_existing=overwrite_existing,
            retry_limit=retry_limit,
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

    def ensure_inactive(self, project_id: str) -> None:
        if self.has_active(project_id):
            raise ValueError("当前工作区仍有标注或翻译任务运行，请先停止任务再重新扫描。")

    @staticmethod
    def has_active_database(database_path: Path) -> bool:
        return JobLifecycleRepository(database_path).active_count() > 0

    @classmethod
    def ensure_database_inactive(cls, database_path: Path) -> None:
        if cls.has_active_database(database_path):
            raise ValueError("当前工作区仍有标注或翻译任务运行，请先停止任务再重新扫描。")

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

    def is_tagger_installation_active(self, installation_id: str) -> bool:
        for workspace in self._workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._workspaces.get(workspace.project_id)
            connection = connect(paths.database)
            try:
                rows = connection.execute(
                    """
                    SELECT execution_snapshot
                    FROM jobs
                    WHERE execution_backend = 'local_tagger'
                      AND status IN ('queued', 'running', 'stopping')
                    """
                ).fetchall()
            finally:
                connection.close()
            for row in rows:
                try:
                    snapshot = TaggerExecutionProfile.model_validate_json(
                        str(row["execution_snapshot"])
                    )
                except ValueError:
                    continue
                if snapshot.installation_id == installation_id:
                    return True
        return False

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
            profile = load_provider_snapshot(str(job["provider_snapshot"]))
            self._translations.save_generated(
                project_id,
                asset_id,
                str(configuration["target_language"]),
                content,
                expected_source_hash=source_hash,
                provider_profile_id=str(job["provider_profile_id"]),
                provider_profile_name=profile.name,
                model=profile.model_id,
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
            rows = []
            batches = (
                [unique_ids[start : start + 500] for start in range(0, len(unique_ids), 500)]
                if unique_ids
                else [[]]
            )
            for batch in batches:
                selected_clause = ""
                if batch:
                    placeholders = ",".join("?" for _ in batch)
                    selected_clause = f"AND a.id IN ({placeholders})"
                rows.extend(
                    connection.execute(
                        f"""
                        SELECT a.id, a.relative_path, a.annotation_relative_path,
                               t.source_annotation_hash
                        FROM assets a
                        LEFT JOIN annotation_translations t
                          ON t.asset_id = a.id AND t.language = ?
                        WHERE a.is_present = 1
                          AND a.annotation_status NOT IN ('missing', 'encoding_error')
                          {selected_clause}
                        ORDER BY a.relative_path COLLATE NOCASE
                        """,
                        [language, *batch],
                    ).fetchall()
                )
            rows.sort(key=lambda row: str(row["relative_path"]).casefold())
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
