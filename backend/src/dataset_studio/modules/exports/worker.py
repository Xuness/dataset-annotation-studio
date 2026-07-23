from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.core.files import file_sha256
from dataset_studio.modules.exports.models import ExportOperation
from dataset_studio.modules.exports.repository import ExportRepository
from dataset_studio.modules.workspaces.service import WorkspaceService

LOGGER = logging.getLogger("dataset_studio.export_worker")
COPY_CHUNK_SIZE = 1024 * 1024
STOP_CHECK_INTERVAL_CHUNKS = 8


class ExportWorkerContainer(Protocol):
    workspaces: WorkspaceService


class ExportStopped(Exception):
    pass


class ExportInterrupted(Exception):
    pass


class ExportWorker:
    def __init__(self, container: ExportWorkerContainer) -> None:
        self._container = container
        self._shutdown = threading.Event()

    async def run(self, stopped: asyncio.Event) -> None:
        self._recover_orphaned()
        LOGGER.info("Export worker is ready.")
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
        LOGGER.info("Export worker stopped.")

    def _claim_next(self) -> tuple[str, ExportOperation] | None:
        for candidate in self._container.workspaces.worker_candidates("exports"):
            try:
                paths, _ = self._container.workspaces.get(candidate.project_id)
                repository = ExportRepository(paths.database)
                operation = repository.claim_next_operation()
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning(
                    "Dropping unavailable export workspace %s from the worker queue: %s",
                    candidate.project_id,
                    error,
                )
                self._container.workspaces.clear_worker_activity(
                    candidate.project_id,
                    "exports",
                    requested_at=candidate.requested_at,
                )
                continue
            if operation is not None:
                return candidate.project_id, operation
            if not repository.active_count():
                self._container.workspaces.clear_worker_activity(
                    candidate.project_id,
                    "exports",
                    requested_at=candidate.requested_at,
                )
        return None

    def _recover_orphaned(self) -> None:
        for project_id in self._container.workspaces.recent_project_ids():
            try:
                paths, manifest = self._container.workspaces.get(project_id)
                repository = ExportRepository(paths.database)
                recovered = repository.recover_orphaned()
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning("Skipping unavailable export workspace %s: %s", project_id, error)
                self._container.workspaces.clear_worker_activity(project_id, "exports")
                continue
            for operation in recovered:
                destination = Path(operation.destination_path)
                self._cleanup_operation_temp_files(destination, operation.operation_id)
                for target_name in operation.target_names:
                    target = destination / target_name
                    if target.is_file():
                        target.unlink(missing_ok=True)
                LOGGER.info(
                    "Marked export %s interrupted in %s.",
                    operation.operation_id,
                    manifest.name,
                )
            if repository.active_count():
                self._container.workspaces.mark_worker_activity(project_id, "exports")
            else:
                self._container.workspaces.clear_worker_activity(project_id, "exports")

    def _process_operation(self, project_id: str, operation_id: str) -> None:
        paths, _ = self._container.workspaces.get(project_id)
        repository = ExportRepository(paths.database)
        operation = repository.get(operation_id)
        if operation is None:
            return
        current_item_id: str | None = None
        current_item = None
        try:
            items = repository.operation_items(operation_id)
            self._validate_destination(operation, items)
            while item := repository.claim_next_item(operation_id):
                current_item = item
                current_item_id = str(item["id"])
                self._check_stop(repository, operation_id)
                copied_bytes = self._process_item(
                    paths.root,
                    Path(operation.destination_path),
                    operation_id,
                    item,
                    repository,
                )
                repository.complete_item(operation_id, current_item_id, copied_bytes)
                current_item_id = None
                current_item = None

            self._check_stop(repository, operation_id)
            completed_items = repository.operation_items(operation_id)
            self._validate_destination(operation, completed_items, require_complete=True)
            repository.complete(operation_id)
        except ExportStopped:
            repository.reset_running_item(operation_id)
            repository.mark_stopped(operation_id)
        except ExportInterrupted:
            repository.reset_running_item(operation_id)
            repository.mark_interrupted(operation_id)
        except Exception as error:
            message = str(error) or type(error).__name__
            LOGGER.exception("Export %s failed.", operation_id)
            if current_item is not None:
                self._cleanup_item_targets(Path(operation.destination_path), current_item)
            repository.fail(operation_id, message, item_id=current_item_id)

    def _process_item(
        self,
        workspace_root: Path,
        destination: Path,
        operation_id: str,
        item,
        repository: ExportRepository,
    ) -> int:
        root = workspace_root.resolve()
        image_source = (root / str(item["source_relative_path"])).resolve()
        annotation_source = (root / str(item["annotation_relative_path"])).resolve()
        image_target = destination / str(item["target_image_name"])
        annotation_target = destination / str(item["target_annotation_name"])
        published: list[Path] = []
        try:
            if not image_source.is_relative_to(root):
                raise ValueError("图片路径超出当前项目范围。")
            image_bytes = self._copy_verified(
                image_source,
                image_target,
                expected_hash=str(item["image_hash"]),
                expected_size=int(item["image_size"]),
                expected_modified_ns=int(item["image_modified_ns"]),
                operation_id=operation_id,
                repository=repository,
            )
            published.append(image_target)
            self._check_stop(repository, operation_id)

            annotation_bytes = 0
            if int(item["annotation_exists"]):
                if not annotation_source.is_relative_to(root):
                    raise ValueError("标注路径超出当前项目范围。")
                annotation_hash = item["annotation_hash"]
                annotation_modified_ns = item["annotation_modified_ns"]
                if annotation_hash is None or annotation_modified_ns is None:
                    raise ValueError("导出计划缺少同名 TXT 的版本信息。")
                annotation_bytes = self._copy_verified(
                    annotation_source,
                    annotation_target,
                    expected_hash=str(annotation_hash),
                    expected_size=int(item["annotation_size"]),
                    expected_modified_ns=int(annotation_modified_ns),
                    operation_id=operation_id,
                    repository=repository,
                )
                published.append(annotation_target)
            elif annotation_source.exists():
                raise ValueError(
                    f"原先缺失的同名 TXT 已经出现，请重新创建导出任务："
                    f"{item['annotation_relative_path']}"
                )
            return image_bytes + annotation_bytes
        except BaseException:
            for target in reversed(published):
                target.unlink(missing_ok=True)
            raise

    def _copy_verified(
        self,
        source: Path,
        target: Path,
        *,
        expected_hash: str,
        expected_size: int,
        expected_modified_ns: int,
        operation_id: str,
        repository: ExportRepository,
    ) -> int:
        if target.exists():
            raise ValueError(f"导出目标已经存在：{target.name}")
        if not source.is_file():
            raise ValueError(f"源文件已经不存在：{source}")
        stat_before = source.stat()
        if stat_before.st_size != expected_size or stat_before.st_mtime_ns != expected_modified_ns:
            raise ValueError(f"源文件在导出前发生了变化：{source.name}")

        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".dataset-studio-export-{operation_id}-",
            suffix=".copy",
            dir=target.parent,
        )
        temporary = Path(temporary_name)
        digest = hashlib.sha256()
        reserved_target = False
        try:
            with os.fdopen(descriptor, "wb") as target_handle, source.open("rb") as source_handle:
                chunk_number = 0
                while chunk := source_handle.read(COPY_CHUNK_SIZE):
                    digest.update(chunk)
                    target_handle.write(chunk)
                    chunk_number += 1
                    if chunk_number % STOP_CHECK_INTERVAL_CHUNKS == 0:
                        self._check_stop(repository, operation_id)
                target_handle.flush()
                os.fsync(target_handle.fileno())

            stat_after = source.stat()
            if (
                stat_before.st_size,
                stat_before.st_mtime_ns,
            ) != (
                stat_after.st_size,
                stat_after.st_mtime_ns,
            ):
                raise ValueError(f"源文件在复制过程中发生了变化：{source.name}")
            if digest.hexdigest() != expected_hash:
                raise ValueError(f"源文件内容与项目索引不一致，请重新扫描：{source.name}")
            self._check_stop(repository, operation_id)
            shutil.copystat(source, temporary)

            reservation = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(reservation)
            reserved_target = True
            os.replace(temporary, target)
            reserved_target = False
            return expected_size
        except BaseException:
            temporary.unlink(missing_ok=True)
            if reserved_target:
                target.unlink(missing_ok=True)
            raise

    def _validate_destination(
        self,
        operation: ExportOperation,
        items,
        *,
        require_complete: bool = False,
    ) -> None:
        destination = Path(operation.destination_path)
        if not destination.is_dir():
            raise ValueError("导出目录已经不存在或不再是文件夹。")
        self._cleanup_operation_temp_files(destination, operation.id)

        allowed_names: set[str] = set()
        for item in items:
            completed = str(item["status"]) == "completed"
            if require_complete and not completed:
                raise ValueError("导出任务仍有未完成条目。")
            if not completed:
                continue
            image_name = str(item["target_image_name"])
            annotation_name = str(item["target_annotation_name"])
            image_target = destination / image_name
            if not image_target.is_file():
                raise ValueError(f"已导出的图片缺失，无法继续：{image_name}")
            if image_target.stat().st_size != int(item["image_size"]):
                raise ValueError(f"已导出的图片大小发生了变化：{image_name}")
            if file_sha256(image_target) != str(item["image_hash"]):
                raise ValueError(f"已导出的图片内容发生了变化：{image_name}")
            allowed_names.add(image_name)
            if int(item["annotation_exists"]):
                annotation_target = destination / annotation_name
                if not annotation_target.is_file():
                    raise ValueError(f"已导出的同名 TXT 缺失：{annotation_name}")
                if annotation_target.stat().st_size != int(item["annotation_size"]):
                    raise ValueError(f"已导出的同名 TXT 大小发生了变化：{annotation_name}")
                if file_sha256(annotation_target) != str(item["annotation_hash"]):
                    raise ValueError(f"已导出的同名 TXT 内容发生了变化：{annotation_name}")
                allowed_names.add(annotation_name)

        try:
            entries = list(destination.iterdir())
        except OSError as error:
            raise ValueError(f"无法读取导出目录：{error}") from error
        unknown = [entry.name for entry in entries if entry.name not in allowed_names]
        if unknown:
            examples = "、".join(sorted(unknown, key=str.casefold)[:5])
            raise ValueError(f"导出目录中出现了任务之外的文件：{examples}")

    def _check_stop(
        self,
        repository: ExportRepository,
        operation_id: str,
    ) -> None:
        if self._shutdown.is_set():
            raise ExportInterrupted
        if repository.is_stop_requested(operation_id):
            raise ExportStopped

    @staticmethod
    def _cleanup_operation_temp_files(destination: Path, operation_id: str) -> None:
        if not destination.is_dir():
            return
        prefix = f".dataset-studio-export-{operation_id}-"
        for candidate in destination.iterdir():
            if candidate.is_file() and candidate.name.startswith(prefix):
                candidate.unlink(missing_ok=True)

    @staticmethod
    def _cleanup_item_targets(destination: Path, item) -> None:
        (destination / str(item["target_image_name"])).unlink(missing_ok=True)
        if int(item["annotation_exists"]):
            (destination / str(item["target_annotation_name"])).unlink(missing_ok=True)
