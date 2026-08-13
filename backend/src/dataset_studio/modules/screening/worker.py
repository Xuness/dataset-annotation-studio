from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import threading
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.modules.assets.deletions.service import AssetDeletionService
from dataset_studio.modules.exports.service import ExportService
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.screening.metadata import (
    MetadataReadError,
    NormalizedMetadata,
    read_metadata,
)
from dataset_studio.modules.screening.models import ScreeningIntensity, ScreeningOperation
from dataset_studio.modules.screening.repository import MetadataBatchUpdate, ScreeningRepository
from dataset_studio.modules.screening.scoring import ScoringInput, score_batch
from dataset_studio.modules.workspaces.service import WorkspaceService

LOGGER = logging.getLogger("dataset_studio.screening_worker")
METADATA_BATCH_SIZE = 512


class ScreeningWorkerContainer(Protocol):
    workspaces: WorkspaceService
    preprocessing: PreprocessService


class ScreeningStopped(Exception):
    pass


class ScreeningInterrupted(Exception):
    pass


class ScreeningWorker:
    def __init__(self, container: ScreeningWorkerContainer) -> None:
        self._container = container
        self._shutdown = threading.Event()

    async def run(self, stopped: asyncio.Event) -> None:
        self._recover_orphaned()
        LOGGER.info("Screening worker is ready.")
        while not stopped.is_set():
            claimed = self._claim_next()
            if claimed is None:
                with suppress(TimeoutError):
                    await asyncio.wait_for(stopped.wait(), timeout=0.5)
                continue
            project_id, operation = claimed
            self._shutdown.clear()
            process_task = asyncio.create_task(
                asyncio.to_thread(self._process_operation, project_id, operation.id)
            )
            stop_task = asyncio.create_task(stopped.wait())
            done, _ = await asyncio.wait(
                {process_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
            )
            if stop_task in done and not process_task.done():
                self._shutdown.set()
            await process_task
            stop_task.cancel()
            with suppress(asyncio.CancelledError):
                await stop_task
        self._shutdown.set()
        LOGGER.info("Screening worker stopped.")

    def _claim_next(self) -> tuple[str, ScreeningOperation] | None:
        for candidate in self._container.workspaces.worker_candidates("screening"):
            try:
                paths, _ = self._container.workspaces.get(candidate.project_id)
                repository = ScreeningRepository(paths.database)
                if self._workspace_has_conflicting_activity(paths.database):
                    continue
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning(
                    "Dropping unavailable screening workspace %s: %s",
                    candidate.project_id,
                    error,
                )
                self._container.workspaces.clear_worker_activity(
                    candidate.project_id,
                    "screening",
                    requested_at=candidate.requested_at,
                )
                continue

            try:
                with self._container.preprocessing.guard_workspace(
                    candidate.project_id,
                    "claim-screening",
                ):
                    if self._workspace_has_conflicting_activity(paths.database):
                        continue
                    operation = repository.claim_next_operation()
            except ValueError:
                # Another in-process workspace mutation may hold the guard briefly.
                # Keep the queued screening activity so the worker can retry it.
                continue
            except (OSError, sqlite3.Error) as error:
                LOGGER.warning(
                    "Could not claim screening workspace %s yet: %s",
                    candidate.project_id,
                    error,
                )
                continue
            if operation is not None:
                return candidate.project_id, operation
            if not repository.active_count():
                self._container.workspaces.clear_worker_activity(
                    candidate.project_id,
                    "screening",
                    requested_at=candidate.requested_at,
                )
        return None

    @staticmethod
    def _workspace_has_conflicting_activity(database_path: Path) -> bool:
        return (
            PreprocessService.has_active_database(database_path)
            or JobService.has_active_database(database_path)
            or ExportService.has_active_database(database_path)
            or AssetDeletionService.has_active_database(database_path)
        )

    def _recover_orphaned(self) -> None:
        for project_id in self._container.workspaces.recent_project_ids():
            try:
                paths, _ = self._container.workspaces.get(project_id)
                repository = ScreeningRepository(paths.database)
                recovered = repository.recover_orphaned()
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning("Skipping unavailable screening workspace %s: %s", project_id, error)
                self._container.workspaces.clear_worker_activity(project_id, "screening")
                continue
            if recovered:
                LOGGER.info("Marked %d screening operation(s) interrupted.", len(recovered))
            if repository.active_count():
                self._container.workspaces.mark_worker_activity(project_id, "screening")
            else:
                self._container.workspaces.clear_worker_activity(project_id, "screening")

    def _process_operation(self, project_id: str, operation_id: str) -> None:
        paths, _ = self._container.workspaces.get(project_id)
        repository = ScreeningRepository(paths.database)
        operation = repository.get(operation_id)
        if operation is None:
            return
        config = operation.configuration_snapshot
        fallback_snapshot = config.get("metadata_snapshot_at")
        try:
            # Resumed operations may already have durable parsed rows. New rows stay
            # in memory for scoring, so the common first run does not reread and
            # deserialize every snapshot from the workspace SQLite database.
            scoring_inputs = [
                self._scoring_input(row) for row in repository.parsed_rows(operation_id)
            ]
            pending_rows = repository.pending_rows(operation_id)
            for start in range(0, len(pending_rows), METADATA_BATCH_SIZE):
                self._check_stop(repository, operation_id)
                rows = pending_rows[start : start + METADATA_BATCH_SIZE]
                updates: list[MetadataBatchUpdate] = []
                for row in rows:
                    # Shutdown is checked without touching SQLite for every sidecar.
                    # User-requested stops are observed at the bounded batch boundary.
                    if self._shutdown.is_set():
                        break
                    update = self._metadata_update(
                        row,
                        root=paths.root,
                        fallback_snapshot_at=(
                            str(fallback_snapshot) if fallback_snapshot is not None else None
                        ),
                    )
                    updates.append(update)
                    if update.result is not None and update.candidate_pool is None:
                        scoring_inputs.append(
                            self._scoring_input_from_metadata(row, update.result.metadata)
                        )
                if updates:
                    repository.save_metadata_batch(
                        operation_id,
                        updates,
                        current_relative_path=str(rows[len(updates) - 1]["source_relative_path"]),
                    )
                self._check_stop(repository, operation_id)

            self._check_stop(repository, operation_id)
            intensity = ScreeningIntensity(str(config.get("intensity", "balanced")))
            outputs = score_batch(scoring_inputs, intensity=intensity)
            self._check_stop(repository, operation_id)
            repository.save_scores(operation_id, outputs)
            self._check_stop(repository, operation_id)
            repository.complete(operation_id)
        except ScreeningStopped:
            repository.mark_stopped(operation_id)
        except ScreeningInterrupted:
            repository.mark_interrupted(operation_id)
        except Exception as error:
            LOGGER.exception("Screening operation %s failed.", operation_id)
            repository.fail(operation_id, str(error))
        finally:
            if not repository.active_count():
                self._container.workspaces.clear_worker_activity(project_id, "screening")

    def _check_stop(self, repository: ScreeningRepository, operation_id: str) -> None:
        if self._shutdown.is_set():
            raise ScreeningInterrupted
        if repository.is_stop_requested(operation_id):
            raise ScreeningStopped

    @staticmethod
    def _metadata_update(
        row,
        *,
        root: Path,
        fallback_snapshot_at: str | None,
    ) -> MetadataBatchUpdate:
        item_id = str(row["id"])
        if (
            row["metadata_relative_path"] is None
            or row["metadata_size"] is None
            or row["metadata_modified_ns"] is None
        ):
            return MetadataBatchUpdate(
                item_id=item_id,
                candidate_pool="invalid",
                error_code="METADATA_MISSING_AT_CREATE",
                error_message="任务创建时同名 Danbooru JSON 不可用。",
            )
        try:
            result = read_metadata(
                root,
                str(row["metadata_relative_path"]),
                fallback_snapshot_at=fallback_snapshot_at,
                expected_size=int(row["metadata_size"]),
                expected_modified_ns=int(row["metadata_modified_ns"]),
            )
        except MetadataReadError as error:
            return MetadataBatchUpdate(
                item_id=item_id,
                candidate_pool="invalid",
                error_code=error.code,
                error_message=str(error),
            )
        if result.metadata.disposition == "valid":
            return MetadataBatchUpdate(item_id=item_id, result=result)
        return MetadataBatchUpdate(
            item_id=item_id,
            result=result,
            candidate_pool=result.metadata.disposition,
            error_code="DANBOORU_" + result.metadata.disposition.upper(),
            error_message="Danbooru 元数据状态不允许参与批次排名。",
            warnings=result.metadata.warnings,
        )

    @staticmethod
    def _scoring_input(row) -> ScoringInput:
        try:
            snapshot = json.loads(str(row["normalized_snapshot"]))
        except (json.JSONDecodeError, TypeError) as error:
            raise ValueError("筛选条目的元数据快照无效。") from error
        if not isinstance(snapshot, dict):
            raise ValueError("筛选条目的元数据快照无效。")
        snapshot["warnings"] = tuple(snapshot.get("warnings", []))
        metadata = NormalizedMetadata(**snapshot)
        return ScreeningWorker._scoring_input_from_metadata(row, metadata)

    @staticmethod
    def _scoring_input_from_metadata(row, metadata: NormalizedMetadata) -> ScoringInput:
        return ScoringInput(
            item_id=str(row["id"]),
            asset_id=str(row["asset_id"]),
            source_relative_path=str(row["source_relative_path"]),
            image_hash=str(row["image_hash"]) if row["image_hash"] else None,
            width=_positive_int(row["image_width"]),
            height=_positive_int(row["image_height"]),
            metadata=metadata,
        )


def _positive_int(value: object) -> int | None:
    if value is None:
        return None
    parsed = int(value)
    return parsed if parsed > 0 else None
