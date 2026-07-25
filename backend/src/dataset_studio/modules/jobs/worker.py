from __future__ import annotations

import asyncio
import logging
import sqlite3
from collections.abc import Callable, Sequence
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.execution_repository import (
    ItemCompletion,
    JobExecutionRepository,
)
from dataset_studio.modules.jobs.execution_snapshot import load_execution_snapshot
from dataset_studio.modules.jobs.executors.local_dictionary import (
    LocalDictionaryJobExecutor,
)
from dataset_studio.modules.jobs.executors.local_tagger import LocalTaggerJobExecutor
from dataset_studio.modules.jobs.executors.provider import ProviderJobExecutor
from dataset_studio.modules.jobs.lifecycle_repository import JobLifecycleRepository
from dataset_studio.modules.jobs.models import ExecutionBackend, JobItemStatus
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.config import ProviderType
from dataset_studio.modules.providers.factory import create_provider
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.taggers.runtime import TaggerRuntime
from dataset_studio.modules.translations.service import TranslationService
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
    tag_dictionaries: TagDictionaryService


class AnnotationWorker:
    def __init__(
        self,
        container: AnnotationWorkerContainer,
        provider_factory: Callable[[ProviderType], ModelProvider] | None = None,
    ) -> None:
        self._container = container
        resolved_provider_factory = provider_factory or (
            lambda provider_type: create_provider(provider_type, container.codex)
        )
        self._active: set[asyncio.Task[None]] = set()
        self._active_profiles: dict[asyncio.Task[None], str] = {}
        self._local_tagger_executor = LocalTaggerJobExecutor(container)
        self._local_dictionary_executor = LocalDictionaryJobExecutor(container)
        self._provider_executor = ProviderJobExecutor(
            container,
            resolved_provider_factory,
        )

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
            backend = ExecutionBackend(str(job.get("execution_backend") or "provider"))
            if backend == ExecutionBackend.LOCAL_DICTIONARY:
                await self._local_dictionary_executor.process_item(
                    project_id,
                    job,
                    item,
                    repository,
                )
            else:
                await self._provider_executor.process_item(
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
