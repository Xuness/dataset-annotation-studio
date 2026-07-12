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
from dataset_studio.modules.jobs.models import JobItemStatus
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

LOGGER = logging.getLogger("dataset_studio.worker")


class AnnotationWorker:
    def __init__(
        self,
        container: AppContainer,
        provider_factory: Callable[[ProviderType], ModelProvider] = create_provider,
    ) -> None:
        self._container = container
        self._provider_factory = provider_factory
        self._active: set[asyncio.Task[None]] = set()

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
                available = profile.concurrency - repository.running_count(str(job["id"]))
                for item in repository.claim_items(str(job["id"]), available):
                    task = asyncio.create_task(
                        self._process_item(workspace.project_id, paths.root, paths.runs, job, item)
                    )
                    self._active.add(task)

    def _reap_finished_tasks(self) -> None:
        finished = {task for task in self._active if task.done()}
        self._active.difference_update(finished)
        for task in finished:
            try:
                task.result()
            except asyncio.CancelledError:
                pass
            except Exception:
                LOGGER.exception("Unexpected worker item failure.")

    async def _process_item(
        self,
        project_id: str,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        item: dict[str, object],
    ) -> None:
        paths, _ = self._container.workspaces.get(project_id)
        repository = JobExecutionRepository(paths.database)
        job_id = str(job["id"])
        item_id = str(item["id"])
        asset_id = str(item["asset_id"])
        if repository.is_stop_requested(job_id):
            repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
            return

        profile = ProviderProfile.model_validate_json(str(job["provider_snapshot"]))
        try:
            api_key = self._container.presets.get_api_key(str(job["provider_profile_id"]))
        except ValueError as error:
            repository.finish_item(item_id, JobItemStatus.FAILED, error=str(error))
            return

        image_path = self._container.assets.image_path(project_id, asset_id)
        metadata = self._container.assets.metadata(project_id, asset_id)
        selected_fields = json.loads(str(job["json_fields_snapshot"]))
        user_prompt = compose_user_prompt(
            str(job["user_prompt_snapshot"]),
            metadata.value if metadata.exists and not metadata.error else None,
            selected_fields,
        )
        system_snapshot = json.loads(str(job["system_prompt_snapshot"]))
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

        for _ in range(previous_attempts, max_attempts):
            if repository.is_stop_requested(job_id):
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                return
            attempt_id, attempt_number = repository.start_attempt(item_id)
            try:
                response = await complete_until_stopped(
                    provider,
                    profile,
                    api_key,
                    request,
                    lambda: repository.is_stop_requested(job_id),
                )
                payload_path = self._save_response_payload(
                    workspace_root,
                    runs_root,
                    job_id,
                    asset_id,
                    attempt_number,
                    response,
                )
                validation = validate_tag_balance(response.content)
                if not validation.valid:
                    last_error = validation.issues[0].message
                    repository.finish_attempt(
                        attempt_id,
                        status="validation_failed",
                        response_content=response.content,
                        error_message=last_error,
                        provider_payload_path=payload_path,
                        input_tokens=response.input_tokens,
                        output_tokens=response.output_tokens,
                        finish_reason=response.finish_reason,
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
                            finish_reason=response.finish_reason,
                        )
                        repository.finish_item(item_id, JobItemStatus.SKIPPED)
                        return
                    self._container.annotations.save_generated(
                        project_id, asset_id, response.content
                    )
                    repository.finish_attempt(
                        attempt_id,
                        status="succeeded",
                        response_content=response.content,
                        provider_payload_path=payload_path,
                        input_tokens=response.input_tokens,
                        output_tokens=response.output_tokens,
                        finish_reason=response.finish_reason,
                    )
                    repository.finish_item(
                        item_id,
                        JobItemStatus.SUCCEEDED,
                        validation_status=validation.status.value,
                    )
                    return
            except JobStopped:
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    error_message="任务已由用户停止。",
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
                )
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                raise
            except Exception as error:
                last_error = str(error)
                repository.finish_attempt(
                    attempt_id,
                    status="internal_error",
                    error_message=last_error,
                )

            if attempt_number < max_attempts:
                await asyncio.sleep(min(2 ** (attempt_number - 1), 8))

        repository.finish_item(
            item_id,
            JobItemStatus.FAILED,
            error=last_error,
            validation_status="failed",
        )

    @staticmethod
    def _save_response_payload(
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        asset_id: str,
        attempt_number: int,
        response: ProviderResponse,
    ) -> str:
        path = runs_root / job_id / asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "content": response.content,
            "finish_reason": response.finish_reason,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
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
        error: ProviderRequestError,
    ) -> str:
        path = runs_root / job_id / asset_id / f"attempt-{attempt_number}-error.json"
        payload = {
            "error": str(error),
            "status_code": error.status_code,
            "response": error.response_text,
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()
