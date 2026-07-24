from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from collections.abc import Callable, Sequence
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from dataset_studio.core.errors import ResourceConflictError, WorkspaceNotFoundError
from dataset_studio.core.files import atomic_write_text
from dataset_studio.modules.annotations.models import AnnotationChannel
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.execution_repository import (
    ItemCompletion,
    JobExecutionRepository,
)
from dataset_studio.modules.jobs.execution_snapshot import load_execution_snapshot
from dataset_studio.modules.jobs.executors.local_tagger import LocalTaggerJobExecutor
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import ExecutionBackend, JobItemStatus, JobKind
from dataset_studio.modules.jobs.provider_call import JobStopped, complete_until_stopped
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.prompts.composer import compose_user_prompt
from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.config import (
    CodexModelOptions,
    OpenAICompatibleModelOptions,
    OpenCodeGoModelOptions,
    OpenRouterModelOptions,
    ProviderExecutionProfile,
    ProviderType,
)
from dataset_studio.modules.providers.factory import create_provider
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.taggers.runtime import TaggerRuntime
from dataset_studio.modules.translations.prompt import translation_user_prompt
from dataset_studio.modules.translations.service import (
    TranslationService,
    TranslationSourceChangedError,
)
from dataset_studio.modules.translations.validation import validate_translation_structure
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkerWorkspaceCandidate
from dataset_studio.modules.workspaces.service import WorkspaceService

LOGGER = logging.getLogger("dataset_studio.worker")
_LOCAL_TAGGER_CLAIM_SIZE = 16


class AnnotationWorkerContainer(Protocol):
    workspaces: WorkspaceService
    presets: PresetService
    translations: TranslationService
    assets: AssetService
    annotations: AnnotationService
    asset_deletions: AssetDeletionService
    preprocessing: PreprocessService
    codex: CodexRuntime
    tagger_runtime: TaggerRuntime


class AnnotationWorker:
    def __init__(
        self,
        container: AnnotationWorkerContainer,
        provider_factory: Callable[[ProviderType], ModelProvider] | None = None,
    ) -> None:
        self._container = container
        self._provider_factory = provider_factory or (
            lambda provider_type: create_provider(provider_type, container.codex)
        )
        self._active: set[asyncio.Task[None]] = set()
        self._active_profiles: dict[asyncio.Task[None], str] = {}
        self._local_tagger_executor = LocalTaggerJobExecutor(container)

    async def run(self, stopped: asyncio.Event) -> None:
        recovered_preprocessing = self._container.preprocessing.recover_orphaned()
        if recovered_preprocessing:
            LOGGER.info(
                "Recovered %s interrupted preprocessing operation(s).",
                recovered_preprocessing,
            )
        self._recover_orphaned_asset_deletions()
        self._recover_orphaned_jobs()
        LOGGER.info("Task worker is ready.")
        while not stopped.is_set():
            self._reap_finished_tasks()
            self._container.tagger_runtime.prune_missing_installations()
            self._schedule_available_items()
            with suppress(TimeoutError):
                await asyncio.wait_for(stopped.wait(), timeout=0.5)

        if self._active:
            LOGGER.info("Waiting for %s active request(s) to stop.", len(self._active))
            for task in self._active:
                task.cancel()
            await asyncio.gather(*self._active, return_exceptions=True)
        LOGGER.info("Task worker stopped.")

    def _recover_orphaned_jobs(self) -> None:
        for project_id in self._container.workspaces.recent_project_ids():
            try:
                paths, manifest = self._container.workspaces.get(project_id)
                repository = JobLifecycleRepository(paths.database)
                recovered = repository.recover_orphaned()
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning("Skipping unavailable job workspace %s: %s", project_id, error)
                self._container.workspaces.clear_worker_activity(project_id, "jobs")
                continue
            if recovered:
                LOGGER.info("Marked %s job(s) interrupted in %s.", recovered, manifest.name)
            if repository.active_count():
                self._container.workspaces.mark_worker_activity(project_id, "jobs")
            else:
                self._container.workspaces.clear_worker_activity(project_id, "jobs")

    def _recover_orphaned_asset_deletions(self) -> None:
        service = getattr(self._container, "asset_deletions", None)
        if service is None:
            return
        for workspace in self._container.workspaces.list_recent():
            if not workspace.exists:
                continue
            with self._container.preprocessing.guard_workspace(
                workspace.project_id,
                "recover-asset-deletions",
            ):
                recovered = service.recover_orphaned(workspace.project_id)
            if recovered:
                LOGGER.info(
                    "Recovered %s interrupted asset deletion(s) in %s.",
                    recovered,
                    workspace.name,
                )

    def _schedule_available_items(self) -> None:
        for candidate in self._container.workspaces.worker_candidates("jobs"):
            try:
                paths, _ = self._container.workspaces.get(candidate.project_id)
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning(
                    "Dropping unavailable job workspace %s from the worker queue: %s",
                    candidate.project_id,
                    error,
                )
                self._container.workspaces.clear_worker_activity(
                    candidate.project_id,
                    "jobs",
                    requested_at=candidate.requested_at,
                )
                continue
            self._schedule_workspace(candidate, paths)

    def _schedule_workspace(
        self,
        candidate: WorkerWorkspaceCandidate,
        paths: WorkspacePaths,
    ) -> None:
        repository = JobExecutionRepository(paths.database)
        lifecycle = JobLifecycleRepository(paths.database)
        lifecycle.finalize_jobs()
        for job in repository.runnable_jobs():
            backend = ExecutionBackend(str(job.get("execution_backend") or "provider"))
            profile = load_execution_snapshot(
                backend,
                job.get("execution_snapshot"),
                legacy_provider_snapshot=str(job["provider_snapshot"]),
            )
            active_key = f"{backend.value}:{profile.id}"
            profile_running = sum(
                active_profile == active_key for active_profile in self._active_profiles.values()
            )
            if isinstance(profile, TaggerExecutionProfile):
                if profile_running or self._has_active_local_tagger():
                    continue
                items = repository.claim_items(
                    str(job["id"]),
                    max(_LOCAL_TAGGER_CLAIM_SIZE, profile.batch_size or 0),
                )
                if not items:
                    continue
                task = asyncio.create_task(
                    self._process_local_tagger_batch(
                        candidate.project_id,
                        paths.database,
                        paths.root,
                        paths.runs,
                        job,
                        items,
                        profile,
                    )
                )
                self._active.add(task)
                self._active_profiles[task] = active_key
                continue
            available = profile.concurrency - profile_running
            for item in repository.claim_items(str(job["id"]), available):
                task = asyncio.create_task(
                    self._process_item(
                        candidate.project_id,
                        paths.database,
                        paths.root,
                        paths.runs,
                        job,
                        item,
                    )
                )
                self._active.add(task)
                self._active_profiles[task] = active_key

        if not lifecycle.active_count():
            self._container.workspaces.clear_worker_activity(
                candidate.project_id,
                "jobs",
                requested_at=candidate.requested_at,
            )

    def _has_active_local_tagger(self) -> bool:
        prefix = f"{ExecutionBackend.LOCAL_TAGGER.value}:"
        return any(key.startswith(prefix) for key in self._active_profiles.values())

    def _reap_finished_tasks(self) -> None:
        finished = {task for task in self._active if task.done()}
        self._active.difference_update(finished)
        for task in finished:
            self._active_profiles.pop(task, None)
            try:
                task.result()
            except asyncio.CancelledError:
                pass
            except Exception:
                LOGGER.exception("Unexpected worker item failure.")

    async def _process_item(
        self,
        project_id: str,
        database_path: Path,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        item: dict[str, object],
    ) -> None:
        repository = JobExecutionRepository(database_path)
        item_id = str(item["id"])
        try:
            await self._process_item_inner(
                project_id,
                workspace_root,
                runs_root,
                job,
                item,
                repository,
            )
        except asyncio.CancelledError:
            with suppress(Exception):
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
            raise
        except Exception as error:
            message = str(error) or type(error).__name__
            LOGGER.exception("Worker item %s failed before it could finish cleanly.", item_id)
            with suppress(Exception):
                repository.finish_item(
                    item_id,
                    JobItemStatus.FAILED,
                    error=f"内部错误：{message}",
                    validation_status="failed",
                )

    async def _process_local_tagger_batch(
        self,
        project_id: str,
        database_path: Path,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        items: Sequence[dict[str, object]],
        profile: TaggerExecutionProfile,
    ) -> None:
        repository = JobExecutionRepository(database_path)
        try:
            await self._local_tagger_executor.process_batch(
                project_id,
                workspace_root,
                runs_root,
                job,
                items,
                repository,
                profile,
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            message = str(error) or type(error).__name__
            LOGGER.exception(
                "Local tagger batch for job %s failed before it could finish cleanly.",
                job["id"],
            )
            with suppress(Exception):
                repository.finish_batch(
                    [],
                    [
                        ItemCompletion(
                            item_id=str(item["id"]),
                            status=JobItemStatus.FAILED,
                            error=f"内部错误：{message}",
                            validation_status="failed",
                        )
                        for item in items
                    ],
                )

    async def _process_item_inner(
        self,
        project_id: str,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        item: dict[str, object],
        repository: JobExecutionRepository,
    ) -> None:
        job_id = str(job["id"])
        item_id = str(item["id"])
        asset_id = str(item["asset_id"])
        if repository.is_stop_requested(job_id):
            repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
            return

        backend = ExecutionBackend(str(job.get("execution_backend") or "provider"))
        kind = JobKind(str(job["kind"]))
        execution_profile = load_execution_snapshot(
            backend,
            job.get("execution_snapshot"),
            legacy_provider_snapshot=str(job["provider_snapshot"]),
        )
        if isinstance(execution_profile, TaggerExecutionProfile):
            await self._local_tagger_executor.process_batch(
                project_id,
                workspace_root,
                runs_root,
                job,
                [item],
                repository,
                execution_profile,
            )
            return
        output_channel = AnnotationChannel(str(job["output_channel"]))
        if (
            kind == JobKind.ANNOTATION
            and not bool(job["overwrite_existing"])
            and self._container.annotations.get_channel(
                project_id,
                asset_id,
                output_channel,
            ).exists
        ):
            repository.finish_item(item_id, JobItemStatus.SKIPPED)
            return
        profile = execution_profile
        try:
            credential = self._container.presets.get_provider_credential(profile)
        except ValueError as error:
            repository.finish_item(item_id, JobItemStatus.FAILED, error=str(error))
            return

        system_snapshot = json.loads(str(job["system_prompt_snapshot"]))
        source_content: str | None = None
        source_hash: str | None = None
        expected_output_modified_at: str | None = None
        translation_configuration: dict[str, object] = {}
        if kind == JobKind.TRANSLATION:
            translation_configuration = json.loads(str(job["configuration_snapshot"]))
            language = str(translation_configuration["target_language"])
            policy = str(translation_configuration["translation_policy"])
            source = self._container.translations.read_source(project_id, asset_id)
            if source is None:
                repository.finish_item(
                    item_id,
                    JobItemStatus.FAILED,
                    error="源标注已不存在，无法翻译。",
                    validation_status="source_missing",
                )
                return
            if not self._container.translations.should_translate(
                project_id,
                asset_id,
                language,
                policy,
            ):
                repository.finish_item(item_id, JobItemStatus.SKIPPED)
                return
            translation_document = self._container.translations.get(
                project_id,
                asset_id,
                language,
            )
            expected_output_modified_at = translation_document.modified_at
            source_content, source_hash = source
            image_path = None
            user_prompt = translation_user_prompt(language, source_content)
        else:
            expected_output_modified_at = (
                str(item["output_base_revision_id"])
                if item.get("output_base_revision_id")
                else None
            )
            image_path = self._container.assets.image_path(project_id, asset_id)
            metadata = self._container.assets.metadata(project_id, asset_id)
            selected_fields = json.loads(str(job["json_fields_snapshot"]))
            tag_revision_id = (
                repository.annotation_input_revision(item_id, "tag_context")
                if bool(job["use_confirmed_tags"])
                else None
            )
            auxiliary_tags = (
                [
                    tag.name
                    for tag in self._container.annotations.revision_tags(
                        project_id,
                        tag_revision_id,
                    )
                ]
                if tag_revision_id
                else []
            )
            user_prompt = compose_user_prompt(
                str(job["user_prompt_snapshot"]),
                metadata.value if metadata.exists and not metadata.error else None,
                selected_fields,
                auxiliary_tags,
            )
        request = MultimodalRequest(
            image_path=image_path,
            system_prompt=str(system_snapshot["system_prompt"]),
            user_prompt=user_prompt,
        )
        provider = self._provider_factory(profile.provider_type)
        max_attempts = int(job["retry_limit"]) + 1
        previous_attempts = int(item["attempt_count"])
        last_error = "请求未完成。"

        for cycle_attempt in range(previous_attempts + 1, max_attempts + 1):
            if repository.is_stop_requested(job_id):
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                return
            attempt_id, attempt_number = repository.start_attempt(
                item_id,
                source_annotation_hash=source_hash,
            )
            payload_path = self._save_request_payload(
                workspace_root,
                runs_root,
                job_id,
                asset_id,
                attempt_number,
                profile,
                request,
            )
            try:
                response = await complete_until_stopped(
                    provider,
                    profile,
                    credential,
                    request,
                    lambda: repository.is_stop_requested(job_id),
                )
                payload_path = self._save_response_payload(
                    workspace_root,
                    runs_root,
                    job_id,
                    asset_id,
                    attempt_number,
                    profile,
                    request,
                    response,
                )
                if kind == JobKind.TRANSLATION:
                    assert source_content is not None
                    validation_valid, validation_status = validate_translation_structure(
                        source_content,
                        response.content,
                    )
                    validation_error = None if validation_valid else validation_status
                else:
                    validation = validate_tag_balance(response.content)
                    validation_valid = validation.valid
                    validation_status = validation.status.value
                    validation_error = None if validation.valid else validation.issues[0].message
                if not validation_valid:
                    last_error = validation_error or "响应内容校验失败。"
                    repository.finish_attempt(
                        attempt_id,
                        status="validation_failed",
                        response_content=response.content,
                        error_message=last_error,
                        provider_payload_path=payload_path,
                        input_tokens=response.input_tokens,
                        output_tokens=response.output_tokens,
                        cache_read_tokens=response.cache_read_tokens,
                        cache_write_tokens=response.cache_write_tokens,
                        reasoning_tokens=response.reasoning_tokens,
                        finish_reason=response.finish_reason,
                    )
                else:
                    if kind == JobKind.TRANSLATION:
                        language = str(translation_configuration["target_language"])
                        policy = str(translation_configuration["translation_policy"])
                        if not self._container.translations.should_translate(
                            project_id,
                            asset_id,
                            language,
                            policy,
                        ):
                            repository.finish_attempt(
                                attempt_id,
                                status="skipped_existing",
                                response_content=response.content,
                                provider_payload_path=payload_path,
                                input_tokens=response.input_tokens,
                                output_tokens=response.output_tokens,
                                cache_read_tokens=response.cache_read_tokens,
                                cache_write_tokens=response.cache_write_tokens,
                                reasoning_tokens=response.reasoning_tokens,
                                finish_reason=response.finish_reason,
                            )
                            repository.finish_item(item_id, JobItemStatus.SKIPPED)
                            return
                        assert source_hash is not None
                        self._container.translations.save_generated(
                            project_id,
                            asset_id,
                            language,
                            response.content,
                            expected_source_hash=source_hash,
                            provider_profile_id=profile.id,
                            provider_profile_name=profile.name,
                            model=profile.model_id,
                            expected_modified_at=expected_output_modified_at,
                            lease_owner_id=item_id,
                            source_job_item_id=item_id,
                        )
                    else:
                        if self._container.annotations.get_channel(
                            project_id,
                            asset_id,
                            output_channel,
                        ).exists and not bool(job["overwrite_existing"]):
                            repository.finish_attempt(
                                attempt_id,
                                status="skipped_existing",
                                response_content=response.content,
                                provider_payload_path=payload_path,
                                input_tokens=response.input_tokens,
                                output_tokens=response.output_tokens,
                                cache_read_tokens=response.cache_read_tokens,
                                cache_write_tokens=response.cache_write_tokens,
                                reasoning_tokens=response.reasoning_tokens,
                                finish_reason=response.finish_reason,
                            )
                            repository.finish_item(item_id, JobItemStatus.SKIPPED)
                            return
                        self._container.annotations.save_generated(
                            project_id,
                            asset_id,
                            response.content,
                            channel=output_channel,
                            expected_modified_at=expected_output_modified_at,
                            lease_owner_id=item_id,
                            source_job_item_id=item_id,
                            input_revisions=(
                                ((tag_revision_id, "tag_context"),) if tag_revision_id else ()
                            ),
                        )
                    repository.finish_attempt(
                        attempt_id,
                        status="succeeded",
                        response_content=response.content,
                        provider_payload_path=payload_path,
                        input_tokens=response.input_tokens,
                        output_tokens=response.output_tokens,
                        cache_read_tokens=response.cache_read_tokens,
                        cache_write_tokens=response.cache_write_tokens,
                        reasoning_tokens=response.reasoning_tokens,
                        finish_reason=response.finish_reason,
                    )
                    repository.finish_item(
                        item_id,
                        JobItemStatus.SUCCEEDED,
                        validation_status=validation_status,
                    )
                    return
            except TranslationSourceChangedError as error:
                last_error = str(error)
                repository.finish_attempt(
                    attempt_id,
                    status="source_changed",
                    response_content=response.content,
                    error_message=last_error,
                    provider_payload_path=payload_path,
                    input_tokens=response.input_tokens,
                    output_tokens=response.output_tokens,
                    cache_read_tokens=response.cache_read_tokens,
                    cache_write_tokens=response.cache_write_tokens,
                    reasoning_tokens=response.reasoning_tokens,
                    finish_reason=response.finish_reason,
                )
                repository.finish_item(
                    item_id,
                    JobItemStatus.FAILED,
                    error=last_error,
                    validation_status="source_changed",
                )
                return
            except ResourceConflictError as error:
                last_error = str(error)
                repository.finish_attempt(
                    attempt_id,
                    status="output_changed",
                    response_content=response.content,
                    error_message=last_error,
                    provider_payload_path=payload_path,
                    input_tokens=response.input_tokens,
                    output_tokens=response.output_tokens,
                    cache_read_tokens=response.cache_read_tokens,
                    cache_write_tokens=response.cache_write_tokens,
                    reasoning_tokens=response.reasoning_tokens,
                    finish_reason=response.finish_reason,
                )
                repository.finish_item(
                    item_id,
                    JobItemStatus.FAILED,
                    error=last_error,
                    validation_status="output_changed",
                )
                return
            except JobStopped:
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    error_message="任务已由用户停止。",
                    provider_payload_path=payload_path,
                )
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                return
            except ProviderRequestError as error:
                last_error = str(error)
                payload_path = self._save_error_payload(
                    workspace_root,
                    runs_root,
                    job_id,
                    asset_id,
                    attempt_number,
                    profile,
                    request,
                    error,
                )
                repository.finish_attempt(
                    attempt_id,
                    status="request_failed",
                    response_content=error.response_text,
                    error_message=str(error),
                    provider_payload_path=payload_path,
                )
            except asyncio.CancelledError:
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    error_message="应用关闭或任务被停止。",
                    provider_payload_path=payload_path,
                )
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                raise
            except Exception as error:
                last_error = str(error)
                repository.finish_attempt(
                    attempt_id,
                    status="internal_error",
                    error_message=last_error,
                    provider_payload_path=payload_path,
                )

            if cycle_attempt < max_attempts:
                delay = min(2 ** (cycle_attempt - 1), 8)
                for _ in range(delay * 2):
                    if repository.is_stop_requested(job_id):
                        repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                        return
                    await asyncio.sleep(0.5)

        repository.finish_item(
            item_id,
            JobItemStatus.FAILED,
            error=last_error,
            validation_status="failed",
        )

    @staticmethod
    def _save_request_payload(
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        asset_id: str,
        attempt_number: int,
        profile: ProviderExecutionProfile,
        request: MultimodalRequest,
    ) -> str:
        path = runs_root / job_id / asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "artifact_version": 2,
            "kind": "request",
            "request": AnnotationWorker._request_snapshot(profile, request),
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()

    @staticmethod
    def _save_response_payload(
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        asset_id: str,
        attempt_number: int,
        profile: ProviderExecutionProfile,
        request: MultimodalRequest,
        response: ProviderResponse,
    ) -> str:
        path = runs_root / job_id / asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "artifact_version": 2,
            "kind": "response",
            "request": AnnotationWorker._request_snapshot(profile, request),
            "content": response.content,
            "reasoning_content": response.reasoning_content,
            "finish_reason": response.finish_reason,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
            "cache_read_tokens": response.cache_read_tokens,
            "cache_write_tokens": response.cache_write_tokens,
            "reasoning_tokens": response.reasoning_tokens,
            "raw": response.raw_payload,
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()

    @staticmethod
    def _save_error_payload(
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        asset_id: str,
        attempt_number: int,
        profile: ProviderExecutionProfile,
        request: MultimodalRequest,
        error: ProviderRequestError,
    ) -> str:
        path = runs_root / job_id / asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "artifact_version": 2,
            "kind": "error",
            "request": AnnotationWorker._request_snapshot(profile, request),
            "error": str(error),
            "status_code": error.status_code,
            "response": error.response_text,
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()

    @staticmethod
    def _request_snapshot(
        profile: ProviderExecutionProfile,
        request: MultimodalRequest,
    ) -> dict[str, object]:
        model = profile.model
        options = model.protocol_options
        reasoning_effort = (
            options.reasoning_effort.value
            if isinstance(
                options,
                (
                    OpenRouterModelOptions,
                    OpenAICompatibleModelOptions,
                    OpenCodeGoModelOptions,
                    CodexModelOptions,
                ),
            )
            and options.reasoning_effort
            else None
        )
        return {
            "system_prompt": request.system_prompt,
            "user_prompt": request.user_prompt,
            "image_filename": request.image_path.name if request.image_path else None,
            "parameters": {
                "provider_type": profile.provider_type.value,
                "provider_profile_name": profile.name,
                "model": model.model_id,
                "temperature": model.temperature,
                "max_output_tokens": model.max_output_tokens,
                "timeout_seconds": model.timeout_seconds,
                "top_p": model.top_p,
                "seed": model.seed,
                "service_tier": (
                    options.service_tier.value
                    if isinstance(options, OpenRouterModelOptions) and options.service_tier
                    else None
                ),
                "reasoning_effort": reasoning_effort,
                "prompt_cache_strategy": (
                    options.prompt_cache_strategy.value if options.prompt_cache_strategy else None
                )
                if isinstance(options, OpenRouterModelOptions)
                else None,
            },
        }
