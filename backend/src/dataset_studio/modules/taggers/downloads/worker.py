from __future__ import annotations

import asyncio
import logging
import os
import shutil
import threading
import time
import uuid
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from dataset_studio.modules.taggers.downloads.models import TaggerDownloadStatus
from dataset_studio.modules.taggers.downloads.service import TaggerDownloadService
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.modules.taggers.sources.base import (
    TaggerDownloadStopped,
    TaggerSourceError,
    TaggerTransferProgress,
)

LOGGER = logging.getLogger("dataset_studio.tagger_download_worker")
_PROGRESS_WRITE_INTERVAL = 0.5
_STOP_CHECK_INTERVAL = 0.25
_DISK_RESERVE = 64 * 1024 * 1024


class TaggerDownloadWorkerContainer(Protocol):
    taggers: TaggerService
    tagger_downloads: TaggerDownloadService


class TaggerDownloadWorker:
    def __init__(self, container: TaggerDownloadWorkerContainer) -> None:
        self._container = container
        self._shutdown = threading.Event()
        self._worker_id = f"{os.getpid()}-{uuid.uuid4()}"

    async def run(self, stopped: asyncio.Event) -> None:
        recovered = self._container.tagger_downloads.repository.recover_orphaned()
        if recovered:
            LOGGER.info("Recovered %s interrupted tagger download(s).", recovered)
        LOGGER.info("Tagger download worker is ready.")
        while not stopped.is_set():
            row = self._container.tagger_downloads.repository.claim_next(self._worker_id)
            if row is None:
                with suppress(TimeoutError):
                    await asyncio.wait_for(stopped.wait(), timeout=0.5)
                continue

            self._shutdown.clear()
            process_task = asyncio.create_task(asyncio.to_thread(self._process, row))
            stop_task = asyncio.create_task(stopped.wait())
            done, _ = await asyncio.wait(
                {process_task, stop_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if stop_task in done and not process_task.done():
                self._shutdown.set()
            await process_task
            stop_task.cancel()
            with suppress(asyncio.CancelledError):
                await stop_task

        self._shutdown.set()
        LOGGER.info("Tagger download worker stopped.")

    def _process(self, row) -> None:
        service = self._container.tagger_downloads
        repository = service.repository
        task_id = str(row["id"])
        stop_check = _DownloadStopCheck(repository, task_id, self._shutdown)
        try:
            plan = service.plan_from_row(row)
            current_root = self._container.taggers.model_root()
            task_root = Path(str(row["model_root"])).resolve()
            if current_root != task_root:
                raise ValueError("下载任务的模型库位置与当前设置不一致。")

            installed = service.find_matching_installation(plan)
            if installed is not None:
                repository.complete(task_id, installed.id)
                service.cleanup_staging(row)
                return

            source = service.source()
            source.preflight(plan)
            if stop_check():
                raise TaggerDownloadStopped

            staging = service.staging_path(row)
            staging.mkdir(parents=True, exist_ok=True)
            remaining = max(
                0,
                plan.download_size - int(row["bytes_downloaded"]),
            )
            if shutil.disk_usage(task_root).free < remaining + _DISK_RESERVE:
                raise TaggerSourceError(
                    "insufficient_disk_space",
                    "模型库可用空间不足，无法完成这项下载。",
                )

            repository.set_phase(task_id, TaggerDownloadStatus.DOWNLOADING)
            progress = _ProgressWriter(repository, task_id)
            materialized = source.materialize(
                plan,
                staging,
                on_progress=progress,
                should_stop=stop_check,
            )
            progress.flush()
            repository.set_phase(task_id, TaggerDownloadStatus.VERIFYING)
            if stop_check():
                raise TaggerDownloadStopped

            repository.set_phase(task_id, TaggerDownloadStatus.INSTALLING)
            with self._container.taggers.catalog_guard():
                installed = service.find_matching_installation(plan)
                if installed is None:
                    installed = self._container.taggers.install_downloaded(
                        materialized,
                        plan,
                    )
            repository.complete(task_id, installed.id)
            service.cleanup_staging(row)
        except TaggerDownloadStopped:
            if repository.is_stop_requested(task_id):
                repository.mark_paused(task_id)
            else:
                repository.mark_interrupted(task_id)
        except TaggerSourceError as error:
            repository.fail(task_id, code=error.code, message=str(error))
        except (OSError, ValueError) as error:
            repository.fail(
                task_id,
                code="local_validation_error",
                message=str(error) or type(error).__name__,
            )
        except Exception as error:
            LOGGER.exception("Unexpected tagger download failure for %s.", task_id)
            repository.fail(
                task_id,
                code="internal_error",
                message=f"内部错误：{str(error) or type(error).__name__}",
            )


class _DownloadStopCheck:
    def __init__(
        self,
        repository,
        task_id: str,
        shutdown: threading.Event,
    ) -> None:
        self._repository = repository
        self._task_id = task_id
        self._shutdown = shutdown
        self._last_checked = 0.0
        self._requested = False

    def __call__(self) -> bool:
        if self._shutdown.is_set() or self._requested:
            return True
        now = time.monotonic()
        if now - self._last_checked >= _STOP_CHECK_INTERVAL:
            self._last_checked = now
            self._requested = self._repository.is_stop_requested(self._task_id)
        return self._requested


class _ProgressWriter:
    def __init__(self, repository, task_id: str) -> None:
        self._repository = repository
        self._task_id = task_id
        self._last_write_at = 0.0
        self._last_sample_at = time.monotonic()
        self._last_sample_bytes = 0
        self._latest: TaggerTransferProgress | None = None
        self._speed: float | None = None

    def __call__(self, value: TaggerTransferProgress) -> None:
        self._latest = value
        now = time.monotonic()
        elapsed = now - self._last_sample_at
        if elapsed > 0:
            delta = max(0, value.bytes_downloaded - self._last_sample_bytes)
            sampled_speed = delta / elapsed
            self._speed = (
                sampled_speed if self._speed is None else self._speed * 0.7 + sampled_speed * 0.3
            )
        self._last_sample_at = now
        self._last_sample_bytes = value.bytes_downloaded
        if (
            now - self._last_write_at >= _PROGRESS_WRITE_INTERVAL
            or value.bytes_downloaded >= value.bytes_total
        ):
            self._write(now)

    def flush(self) -> None:
        if self._latest is not None:
            self._write(time.monotonic())

    def _write(self, now: float) -> None:
        assert self._latest is not None
        self._repository.update_progress(
            self._task_id,
            bytes_downloaded=self._latest.bytes_downloaded,
            files_completed=self._latest.files_completed,
            current_file=self._latest.relative_path,
            speed_bps=self._speed,
        )
        self._last_write_at = now
