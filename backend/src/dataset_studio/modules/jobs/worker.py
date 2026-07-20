from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path

from dataset_studio.api.container import AppContainer
from dataset_studio.core.files import atomic_write_text
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import JobItemStatus, JobKind
from dataset_studio.modules.jobs.provider_call import JobStopped, complete_until_stopped
from dataset_studio.modules.presets.models import ProviderProfile, ProviderType
from dataset_studio.modules.prompts.composer import compose_user_prompt
from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.factory import create_provider
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.translations.prompt import translation_user_prompt
from dataset_studio.modules.translations.service import TranslationSourceChangedError
from dataset_studio.modules.translations.validation import validate_translation_structure

LOGGER = logging.getLogger("dataset_studio.worker")


class AnnotationWorker:
    def __init__(
        self,
        container: AppContainer,
        provider_factory: Callable[[ProviderType], ModelProvider] | None = None,
    ) -> None:
        self._container = container
        self._provider_factory = provider_factory or (
            lambda provider_type: create_provider(provider_type, container.codex)
        )
        self._active: set[asyncio.Task[None]] = set()
        self._active_profiles: dict[asyncio.Task[None], str] = {}

    async def run(self, stopped: asyncio.Event) -> None:
        self._recover_orphaned_jobs()
        LOGGER.info("Task worker is ready.")
        while not stopped.is_set():
            self._reap_finished_tasks()
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
        for workspace in self._container.workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._container.workspaces.get(workspace.project_id)
            recovered = JobLifecycleRepository(paths.database).recover_orphaned()
            if recovered:
                LOGGER.info("Marked %s job(s) interrupted in %s.", recovered, workspace.name)

    def _schedule_available_items(self) -> None:
        for workspace in self._container.workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._container.workspaces.get(workspace.project_id)
            repository = JobExecutionRepository(paths.database)
            JobLifecycleRepository(paths.database).finalize_jobs()
            for job in repository.runnable_jobs():
                profile = ProviderProfile.model_validate_json(str(job["provider_snapshot"]))
                profile_running = sum(
                    active_profile == profile.id
                    for active_profile in self._active_profiles.values()
                )
                available = profile.concurrency - profile_running
                for item in repository.claim_items(str(job["id"]), available):
                    task = asyncio.create_task(
                        self._process_item(
                            workspace.project_id,
                            paths.database,
                            paths.root,
                            paths.runs,
                            job,
                            item,
                        )
                    )
                    self._active.add(task)
                    self._active_profiles[task] = profile.id

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

        profile = ProviderProfile.model_validate_json(str(job["provider_snapshot"]))
        try:
            credential = self._container.presets.get_provider_credential(profile)
        except ValueError as error:
            repository.finish_item(item_id, JobItemStatus.FAILED, error=str(error))
            return

        system_snapshot = json.loads(str(job["system_prompt_snapshot"]))
        kind = JobKind(str(job["kind"]))
        source_content: str | None = None
        source_hash: str | None = None
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
            source_content, source_hash = source
            image_path = None
            user_prompt = translation_user_prompt(language, source_content)
        else:
            image_path = self._container.assets.image_path(project_id, asset_id)
            metadata = self._container.assets.metadata(project_id, asset_id)
            selected_fields = json.loads(str(job["json_fields_snapshot"]))
            user_prompt = compose_user_prompt(
                str(job["user_prompt_snapshot"]),
                metadata.value if metadata.exists and not metadata.error else None,
                selected_fields,
            )
        request = MultimodalRequest(
            image_path=image_path,
            system_prompt=str(system_snapshot["system_prompt"]),
            user_prompt=user_prompt,
            model=profile.model,
            temperature=profile.temperature,
            max_output_tokens=profile.max_output_tokens,
            timeout_seconds=profile.timeout_seconds,
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
                            model=profile.model,
                        )
                    else:
                        annotation_path = workspace_root / str(item["annotation_relative_path"])
                        if annotation_path.is_file() and not bool(job["overwrite_existing"]):
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
        profile: ProviderProfile,
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
        profile: ProviderProfile,
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
        profile: ProviderProfile,
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
        profile: ProviderProfile,
        request: MultimodalRequest,
    ) -> dict[str, object]:
        options = profile.request_options
        return {
            "system_prompt": request.system_prompt,
            "user_prompt": request.user_prompt,
            "image_filename": request.image_path.name if request.image_path else None,
            "parameters": {
                "provider_type": profile.provider_type.value,
                "provider_profile_name": profile.name,
                "model": request.model,
                "temperature": request.temperature,
                "max_output_tokens": request.max_output_tokens,
                "timeout_seconds": request.timeout_seconds,
                "top_p": options.top_p,
                "seed": options.seed,
                "service_tier": options.service_tier.value if options.service_tier else None,
                "reasoning_effort": (
                    options.reasoning_effort.value if options.reasoning_effort else None
                ),
                "prompt_cache_strategy": (
                    options.prompt_cache_strategy.value if options.prompt_cache_strategy else None
                ),
            },
        }
