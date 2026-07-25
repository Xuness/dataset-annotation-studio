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

from dataset_studio.modules.tag_dictionaries.downloads.models import (
    TagDictionaryDownloadStatus,
)
from dataset_studio.modules.tag_dictionaries.downloads.service import (
    TagDictionaryDownloadService,
)
from dataset_studio.modules.tag_dictionaries.downloads.source import (
    DictionaryDownloadStopped,
    DictionarySourceError,
    DirectDictionarySource,
    verify_download,
)
from dataset_studio.modules.tag_dictionaries.models import TagDictionarySourceRecord
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService

LOGGER = logging.getLogger("dataset_studio.tag_dictionary_download_worker")
_PROGRESS_WRITE_INTERVAL = 0.5
_STOP_CHECK_INTERVAL = 0.25
_DISK_RESERVE = 64 * 1024 * 1024


class TagDictionaryDownloadWorkerContainer(Protocol):
    tag_dictionaries: TagDictionaryService
    tag_dictionary_downloads: TagDictionaryDownloadService


class TagDictionaryDownloadWorker:
    def __init__(self, container: TagDictionaryDownloadWorkerContainer) -> None:
        self._container = container
        self._shutdown = threading.Event()
        self._worker_id = f"{os.getpid()}-{uuid.uuid4()}"
        self._source = DirectDictionarySource()

    async def run(self, stopped: asyncio.Event) -> None:
        recovered = self._container.tag_dictionary_downloads.repository.recover_orphaned()
        if recovered:
            LOGGER.info("Recovered %s interrupted dictionary download(s).", recovered)
        LOGGER.info("Tag dictionary download worker is ready.")
        while not stopped.is_set():
            row = self._container.tag_dictionary_downloads.repository.claim_next(self._worker_id)
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
        LOGGER.info("Tag dictionary download worker stopped.")

    def _process(self, row) -> None:
        service = self._container.tag_dictionary_downloads
        repository = service.repository
        task_id = str(row["id"])
        stop_check = _StopCheck(repository, task_id, self._shutdown)
        try:
            offer = service.offer_from_row(row)
            root = self._container.tag_dictionaries.dictionary_root()
            if root != Path(str(row["dictionary_root"])).resolve():
                raise ValueError("词典下载任务目录与当前词典库不一致。")
            installed = self._container.tag_dictionaries.find_by_source(
                offer.source_id,
                offer.source_version,
            )
            if installed is not None:
                repository.complete(task_id, installed.id)
                self._cleanup(service, row, task_id)
                return
            assert offer.download_size is not None
            if shutil.disk_usage(root).free < offer.download_size * 2 + _DISK_RESERVE:
                raise DictionarySourceError(
                    "insufficient_disk_space",
                    "词典目录可用空间不足，无法完成下载和索引。",
                )
            staging = service.staging_path(row)
            progress = _ProgressWriter(repository, task_id)
            repository.set_phase(task_id, TagDictionaryDownloadStatus.DOWNLOADING)
            downloaded = self._source.materialize(
                offer,
                staging,
                on_progress=progress,
                should_stop=stop_check,
            )
            progress.flush()
            repository.set_phase(task_id, TagDictionaryDownloadStatus.VERIFYING)
            verify_download(downloaded, offer, stop_check)
            if stop_check():
                raise DictionaryDownloadStopped
            repository.set_phase(task_id, TagDictionaryDownloadStatus.INSTALLING)
            assert offer.sha256 is not None
            with self._container.tag_dictionaries.catalog_guard():
                installed = self._container.tag_dictionaries.find_by_source(
                    offer.source_id,
                    offer.source_version,
                )
                if installed is None:
                    installed = self._container.tag_dictionaries.install_catalog_download(
                        downloaded,
                        adapter_id=offer.adapter_id,
                        source_record=TagDictionarySourceRecord(
                            source_type="catalog_download",
                            source_id=offer.source_id,
                            source_version=offer.source_version,
                            source_url=offer.source_url,
                            offer_id=offer.offer_id,
                            revision=offer.revision,
                            source_sha256=offer.sha256,
                        ),
                        name=offer.name,
                    )
            repository.complete(task_id, installed.id)
            self._cleanup(service, row, task_id)
        except DictionaryDownloadStopped:
            if repository.is_stop_requested(task_id):
                repository.mark_paused(task_id)
            else:
                repository.mark_interrupted(task_id)
        except DictionarySourceError as error:
            repository.fail(task_id, code=error.code, message=str(error))
        except (OSError, ValueError) as error:
            repository.fail(
                task_id,
                code="local_validation_error",
                message=str(error) or type(error).__name__,
            )
        except Exception as error:
            LOGGER.exception("Unexpected dictionary download failure for %s.", task_id)
            repository.fail(
                task_id,
                code="internal_error",
                message=f"内部错误：{str(error) or type(error).__name__}",
            )

    @staticmethod
    def _cleanup(
        service: TagDictionaryDownloadService,
        row,
        task_id: str,
    ) -> None:
        try:
            service.cleanup_staging(row)
        except Exception:
            LOGGER.warning(
                "Dictionary download %s completed but staging cleanup failed.",
                task_id,
                exc_info=True,
            )


class _StopCheck:
    def __init__(self, repository, task_id: str, shutdown: threading.Event) -> None:
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
        self._latest: tuple[int, str] | None = None
        self._speed: float | None = None

    def __call__(self, bytes_downloaded: int, filename: str) -> None:
        self._latest = (bytes_downloaded, filename)
        now = time.monotonic()
        elapsed = now - self._last_sample_at
        if elapsed > 0:
            delta = max(0, bytes_downloaded - self._last_sample_bytes)
            sampled = delta / elapsed
            self._speed = sampled if self._speed is None else self._speed * 0.7 + sampled * 0.3
        self._last_sample_at = now
        self._last_sample_bytes = bytes_downloaded
        if now - self._last_write_at >= _PROGRESS_WRITE_INTERVAL:
            self._write(now)

    def flush(self) -> None:
        if self._latest is not None:
            self._write(time.monotonic())

    def _write(self, now: float) -> None:
        assert self._latest is not None
        downloaded, filename = self._latest
        self._repository.update_progress(
            self._task_id,
            bytes_downloaded=downloaded,
            current_file=filename,
            speed_bps=self._speed,
        )
        self._last_write_at = now
