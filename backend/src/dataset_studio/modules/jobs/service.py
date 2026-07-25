from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path

from dataset_studio.core.errors import (
    JobNotFoundError,
    PresetNotFoundError,
    WorkspaceNotFoundError,
)
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import AnnotationChannel
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
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
)
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
        tag_dictionaries: TagDictionaryService | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._presets = presets
        self._annotations = annotations
        self._translations = translations or TranslationService(workspaces, annotations)
        self._taggers = taggers
        self._tag_dictionaries = tag_dictionaries

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
        if request.execution_backend == ExecutionBackend.LOCAL_DICTIONARY:
            if self._tag_dictionaries is None:
                raise ValueError("当前本地服务没有启用本地 Tag 词典模块。")
            with self._tag_dictionaries.catalog_guard():
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
        use_tags_as_context = False
        if request.execution_backend == ExecutionBackend.LOCAL_TAGGER:
            output_channel = AnnotationChannel.TAGS
            output_language = ""
            output_translation_source_kind = ""
            output_translation_producer_kind = ""
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
                output_channel=output_channel,
                overwrite_existing=request.overwrite_existing,
            )
            if not asset_ids:
                raise ValueError("当前范围内没有需要生成的 Tags；已有 Tags 会被自动跳过。")
            user_prompt_snapshot = ""
            json_fields_snapshot = "[]"
            overwrite_existing = request.overwrite_existing
            retry_limit = 0
        elif request.execution_backend == ExecutionBackend.LOCAL_DICTIONARY:
            assert self._tag_dictionaries is not None
            output_channel = AnnotationChannel.TRANSLATION
            language = self._translations.normalize_language(request.target_language)
            source_kind = TranslationSourceKind.TAGS
            producer_kind = TranslationProducerKind.LOCAL_DICTIONARY
            local_snapshot = self._tag_dictionaries.execution_profile(language)
            if not local_snapshot.sources and local_snapshot.override_count == 0:
                raise ValueError("当前语言没有已启用的本地词典或修正词条。")
            execution_profile_id = local_snapshot.id
            execution_snapshot = local_snapshot.model_dump_json()
            provider_profile_id = ""
            provider_snapshot_json = "{}"
            system_preset_id = ""
            system_prompt_snapshot = json.dumps(
                {
                    "id": "",
                    "name": local_snapshot.name,
                    "system_prompt": "",
                },
                ensure_ascii=False,
            )
            configuration = {
                "target_language": language,
                "translation_policy": request.translation_policy.value,
                "translation_source_kind": source_kind.value,
                "translation_producer_kind": producer_kind.value,
            }
            output_language = language
            output_translation_source_kind = source_kind.value
            output_translation_producer_kind = producer_kind.value
            asset_ids = self._select_translation_assets(
                project_id,
                paths.database,
                request.scope,
                request.asset_ids,
                language=language,
                policy=request.translation_policy,
                source_kind=source_kind,
                producer_kind=producer_kind,
            )
            if not asset_ids:
                raise ValueError("当前范围内没有符合策略且带有 Tags 的素材可翻译。")
            user_prompt_snapshot = ""
            json_fields_snapshot = "[]"
            overwrite_existing = request.translation_policy == ExistingTranslationPolicy.OVERWRITE
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
                output_channel = AnnotationChannel.TRANSLATION
                language = self._translations.normalize_language(request.target_language)
                output_language = language
                source_kind = TranslationSourceKind(request.translation_source_kind)
                producer_kind = DEFAULT_TRANSLATION_PRODUCER_KIND
                output_translation_source_kind = source_kind.value
                output_translation_producer_kind = producer_kind.value
                translation_prompt = self._resolve_translation_prompt(
                    request.translation_prompt_preset_id
                )
                system_preset_id = translation_prompt.id
                system_prompt = render_translation_system_prompt(
                    translation_prompt.system_prompt,
                    language,
                    source_kind,
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
                    "translation_source_kind": source_kind.value,
                    "translation_producer_kind": producer_kind.value,
                }
                asset_ids = self._select_translation_assets(
                    project_id,
                    paths.database,
                    request.scope,
                    request.asset_ids,
                    language=language,
                    policy=request.translation_policy,
                    source_kind=source_kind,
                    producer_kind=producer_kind,
                )
                if not asset_ids:
                    raise ValueError("当前范围内没有符合策略且带有源标注的素材可翻译。")
                user_prompt_snapshot = ""
                json_fields_snapshot = "[]"
                overwrite_existing = (
                    request.translation_policy == ExistingTranslationPolicy.OVERWRITE
                )
            else:
                output_channel = AnnotationChannel.DESCRIPTION
                output_language = ""
                output_translation_source_kind = ""
                output_translation_producer_kind = ""
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
                use_tags_as_context = manifest.settings.use_tags_as_context
                configuration = {
                    "use_tags_as_context": use_tags_as_context,
                }
                asset_ids = self._select_annotation_assets(
                    paths.database,
                    request.scope,
                    request.asset_ids,
                    output_channel=output_channel,
                    overwrite_existing=request.overwrite_existing,
                )
                if not asset_ids:
                    raise ValueError("当前范围内没有需要生成的 LLM 描述；已有描述会被自动跳过。")
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
            output_channel=output_channel.value,
            use_tags_as_context=use_tags_as_context,
            output_language=output_language,
            output_translation_source_kind=output_translation_source_kind,
            output_translation_producer_kind=output_translation_producer_kind,
            retry_limit=retry_limit,
            asset_ids=asset_ids,
        )
        self._workspaces.mark_worker_activity(project_id, "jobs")
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
        self._workspaces.mark_worker_activity(project_id, "jobs")
        return self.get(project_id, job_id, include_items=include_items)

    def stop_all(self, project_id: str) -> int:
        paths, _ = self._workspaces.get(project_id)
        stopped = JobLifecycleRepository(paths.database).request_stop_all()
        if stopped:
            self._workspaces.mark_worker_activity(project_id, "jobs")
        return stopped

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
        active_workspaces = self._active_workspace_databases()
        for _project_id, database in active_workspaces:
            connection = connect(database)
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
            project_count=len(active_workspaces),
            annotation_job_count=annotation_count,
            translation_job_count=translation_count,
        )

    def active_project_ids(self) -> set[str]:
        return {project_id for project_id, _database in self._active_workspace_databases()}

    def is_tagger_installation_active(self, installation_id: str) -> bool:
        for _project_id, database in self._active_workspace_databases():
            connection = connect(database)
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
        for project_id, database in self._active_workspace_databases():
            project_stopped = JobLifecycleRepository(database).request_stop_all()
            stopped += project_stopped
            if project_stopped:
                self._workspaces.mark_worker_activity(project_id, "jobs")
        return stopped

    def resume(self, project_id: str, job_id: str, *, include_items: bool = True) -> JobDetail:
        paths, _ = self._workspaces.get(project_id)
        if JobQueryRepository(paths.database).get_job_row(job_id) is None:
            raise JobNotFoundError(f"找不到任务：{job_id}")
        if not JobLifecycleRepository(paths.database).resume(job_id):
            raise ValueError("只有已停止或意外中断的任务可以继续。")
        self._workspaces.mark_worker_activity(project_id, "jobs")
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
        self._workspaces.mark_worker_activity(project_id, "jobs")
        return self.get(project_id, job_id, include_items=include_items)

    def _active_workspace_databases(self) -> list[tuple[str, Path]]:
        active: list[tuple[str, Path]] = []
        for candidate in self._workspaces.worker_candidates("jobs"):
            try:
                paths, _ = self._workspaces.get(candidate.project_id)
                has_active = JobLifecycleRepository(paths.database).active_count() > 0
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error):
                self._workspaces.clear_worker_activity(
                    candidate.project_id,
                    "jobs",
                    requested_at=candidate.requested_at,
                )
                continue
            if has_active:
                active.append((candidate.project_id, paths.database))
            else:
                self._workspaces.clear_worker_activity(
                    candidate.project_id,
                    "jobs",
                    requested_at=candidate.requested_at,
                )
        return active

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
        if str(job["kind"]) == JobKind.TRANSLATION.value:
            configuration = json.loads(str(job["configuration_snapshot"]))
            if not response.source_hash:
                raise ValueError("这个译文响应缺少对应的源标注版本，无法安全采用。")
            profile = load_provider_snapshot(str(job["provider_snapshot"]))
            self._translations.save_generated(
                project_id,
                response.asset_id,
                str(configuration["target_language"]),
                response.content,
                expected_source_hash=response.source_hash,
                source_kind=str(configuration.get("translation_source_kind", "description")),
                producer_kind=str(configuration.get("translation_producer_kind", "llm")),
                provider_profile_id=str(job["provider_profile_id"]),
                provider_profile_name=profile.name,
                model=profile.model_id,
                manually_accepted=True,
                expected_modified_at=response.output_base_revision_id,
                source_job_item_id=item_id,
                allow_candidate_on_conflict=False,
            )
        else:
            tag_revision_id = execution.annotation_input_revision(item_id, "tag_context")
            self._annotations.save_generated(
                project_id,
                response.asset_id,
                response.content,
                channel=AnnotationChannel(str(job["output_channel"])),
                manually_accepted=True,
                expected_modified_at=response.output_base_revision_id,
                source_job_item_id=item_id,
                input_revisions=(((tag_revision_id, "tag_context"),) if tag_revision_id else ()),
                allow_candidate_on_conflict=False,
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
        database_path: Path,
        scope: JobScope,
        selected_ids: list[str],
        *,
        output_channel: AnnotationChannel,
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
            clauses = ["a.is_present = 1"]
            parameters: list[object] = []
            if not overwrite_existing:
                clauses.append(
                    """
                    NOT EXISTS (
                        SELECT 1
                        FROM annotation_documents d
                        JOIN annotation_document_revisions r
                          ON r.id = d.head_revision_id
                        WHERE d.asset_id = a.id
                          AND d.channel = ?
                          AND d.language = ''
                          AND r.is_tombstone = 0
                    )
                    """
                )
                parameters.append(output_channel.value)
            if not unique_ids:
                rows = connection.execute(
                    f"""
                    SELECT a.id, a.relative_path
                    FROM assets a
                    WHERE {" AND ".join(clauses)}
                    ORDER BY a.relative_path
                    """,
                    parameters,
                ).fetchall()
            else:
                rows = []
                for start in range(0, len(unique_ids), 500):
                    batch = unique_ids[start : start + 500]
                    placeholders = ",".join("?" for _ in batch)
                    rows.extend(
                        connection.execute(
                            f"""
                            SELECT a.id, a.relative_path
                            FROM assets a
                            WHERE {" AND ".join(clauses)}
                              AND a.id IN ({placeholders})
                            """,
                            [*parameters, *batch],
                        ).fetchall()
                    )
                rows.sort(key=lambda row: str(row["relative_path"]).casefold())
            return [str(row["id"]) for row in rows]
        finally:
            connection.close()

    def _select_translation_assets(
        self,
        project_id: str,
        database_path: Path,
        scope: JobScope,
        selected_ids: list[str],
        *,
        language: str,
        policy: ExistingTranslationPolicy,
        source_kind: TranslationSourceKind,
        producer_kind: TranslationProducerKind = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> list[str]:
        unique_ids = list(dict.fromkeys(selected_ids)) if scope == JobScope.SELECTED else []
        if scope == JobScope.SELECTED and not unique_ids:
            return []

        connection = connect(database_path)
        try:
            if unique_ids:
                rows = []
                for start in range(0, len(unique_ids), 500):
                    batch = unique_ids[start : start + 500]
                    placeholders = ",".join("?" for _ in batch)
                    rows.extend(
                        connection.execute(
                            f"""
                            SELECT id, relative_path
                            FROM assets
                            WHERE is_present = 1 AND id IN ({placeholders})
                            """,
                            batch,
                        ).fetchall()
                    )
            else:
                rows = connection.execute(
                    """
                    SELECT id, relative_path
                    FROM assets
                    WHERE is_present = 1
                    ORDER BY relative_path COLLATE NOCASE
                    """
                ).fetchall()
        finally:
            connection.close()
        rows.sort(key=lambda row: str(row["relative_path"]).casefold())
        return self._translations.filter_asset_ids(
            project_id,
            [str(row["id"]) for row in rows],
            language,
            policy.value,
            source_kind=source_kind,
            producer_kind=producer_kind,
        )
