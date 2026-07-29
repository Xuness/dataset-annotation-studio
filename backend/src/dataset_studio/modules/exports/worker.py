from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import stat
import tempfile
import threading
import zipfile
from contextlib import suppress
from pathlib import Path, PurePosixPath
from typing import Protocol

from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.core.files import file_sha256
from dataset_studio.modules.exports.models import ExportOperation, ExportPackaging
from dataset_studio.modules.exports.paths import archive_output_path
from dataset_studio.modules.exports.repository import ExportRepository
from dataset_studio.modules.workspaces.service import WorkspaceService

LOGGER = logging.getLogger("dataset_studio.export_worker")
COPY_CHUNK_SIZE = 1024 * 1024
STOP_CHECK_INTERVAL_CHUNKS = 8
STORED_IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".webp"})
ARCHIVE_COMMENT_PREFIX = b"dataset-studio-export:"
ARCHIVE_STAGING_MARKER_NAME = ".owner"
ARCHIVE_STAGING_FILE_NAME = "archive.zip"


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
                if operation.packaging == ExportPackaging.ZIP.value:
                    self._cleanup_archive_temp_files(destination, operation.operation_id)
                    self._remove_owned_archive(destination, operation.operation_id)
                else:
                    self._cleanup_operation_temp_files(destination, operation.operation_id)
                    for target_name in operation.target_names:
                        target = self._safe_target(destination, target_name)
                        if target is not None and target.is_file():
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
        packaging = ExportPackaging.DIRECTORY
        current_item_id: str | None = None
        current_item = None
        try:
            packaging = self._packaging(operation)
            items = repository.operation_items(operation_id)
            self._validate_destination(operation, items)
            if packaging == ExportPackaging.ZIP:
                self._process_archive(
                    paths.root,
                    operation,
                    repository,
                )
            else:
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
            if packaging == ExportPackaging.ZIP:
                repository.reset_archive_progress(operation_id)
                self._cleanup_archive_outputs(operation)
            else:
                repository.reset_running_item(operation_id)
            repository.mark_stopped(operation_id)
        except ExportInterrupted:
            if packaging == ExportPackaging.ZIP:
                repository.reset_archive_progress(operation_id)
                self._cleanup_archive_outputs(operation)
            else:
                repository.reset_running_item(operation_id)
            repository.mark_interrupted(operation_id)
        except Exception as error:
            message = str(error) or type(error).__name__
            LOGGER.exception("Export %s failed.", operation_id)
            if packaging == ExportPackaging.ZIP:
                repository.reset_archive_progress(operation_id)
                self._cleanup_archive_outputs(operation)
                current_item_id = None
            elif current_item is not None:
                self._cleanup_item_targets(Path(operation.destination_path), current_item)
            repository.fail(operation_id, message, item_id=current_item_id)

    def _process_archive(
        self,
        workspace_root: Path,
        operation: ExportOperation,
        repository: ExportRepository,
    ) -> None:
        destination = Path(operation.destination_path)
        temporary = self._create_archive_temporary(destination, operation.id)
        target = archive_output_path(destination)
        try:
            with zipfile.ZipFile(
                temporary,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
                allowZip64=True,
                strict_timestamps=False,
            ) as archive:
                archive.comment = ARCHIVE_COMMENT_PREFIX + operation.id.encode("ascii")
                while item := repository.claim_next_item(operation.id):
                    item_id = str(item["id"])
                    self._check_stop(repository, operation.id)
                    copied_bytes = self._process_archive_item(
                        workspace_root,
                        operation.id,
                        item,
                        repository,
                        archive,
                    )
                    repository.complete_item(operation.id, item_id, copied_bytes)

            # Windows FlushFileBuffers requires a writable handle even when the
            # archive contents are already complete.
            with temporary.open("r+b") as handle:
                os.fsync(handle.fileno())
            self._check_stop(repository, operation.id)
            completed_items = repository.operation_items(operation.id)
            self._validate_destination(
                operation,
                completed_items,
                require_complete=True,
                allowed_temporary=temporary,
            )
            self._publish_archive(temporary, target)
        finally:
            self._cleanup_archive_temp_files(destination, operation.id)

    @staticmethod
    def _publish_archive(temporary: Path, target: Path) -> None:
        """Publish a complete archive without ever replacing an existing path.

        A hard link is created on the same destination filesystem, so the target
        becomes visible atomically and ``FileExistsError`` leaves an external
        target untouched.  ``os.replace`` cannot provide that guarantee if
        another process creates or swaps the target between the existence check
        and publication.
        """
        try:
            os.link(temporary, target)
        except FileExistsError as error:
            raise ValueError("目标 ZIP 压缩包已经存在，无法覆盖。") from error
        except OSError as error:
            raise ValueError(f"无法安全发布 ZIP 压缩包：{error}") from error
        temporary.unlink(missing_ok=True)

    def _process_archive_item(
        self,
        workspace_root: Path,
        operation_id: str,
        item,
        repository: ExportRepository,
        archive: zipfile.ZipFile,
    ) -> int:
        root = workspace_root.resolve()
        copied_bytes = 0
        for artifact in self._artifacts(item):
            self._check_stop(repository, operation_id)
            relative_path = str(artifact["target_relative_path"])
            archive_name = self._required_archive_name(relative_path)
            if str(artifact["kind"]) == "image":
                source_relative = artifact.get("source_relative_path")
                if not source_relative:
                    raise ValueError("导出图片快照缺少源路径。")
                source = (root / str(source_relative)).resolve()
                if not source.is_relative_to(root):
                    raise ValueError("图片路径超出当前项目范围。")
                copied_bytes += self._write_image_to_archive(
                    archive,
                    archive_name,
                    source,
                    expected_hash=str(artifact["content_hash"]),
                    expected_size=int(artifact["byte_size"]),
                    expected_modified_ns=int(artifact["source_modified_ns"]),
                    operation_id=operation_id,
                    repository=repository,
                )
            else:
                payload = self._artifact_payload(artifact)
                copied_bytes += self._write_payload_to_archive(
                    archive,
                    archive_name,
                    payload,
                    expected_hash=str(artifact["content_hash"]),
                    operation_id=operation_id,
                    repository=repository,
                )
        return copied_bytes

    def _write_image_to_archive(
        self,
        archive: zipfile.ZipFile,
        archive_name: str,
        source: Path,
        *,
        expected_hash: str,
        expected_size: int,
        expected_modified_ns: int,
        operation_id: str,
        repository: ExportRepository,
    ) -> int:
        if not source.is_file():
            raise ValueError(f"源文件已经不存在：{source}")
        stat_before = source.stat()
        if stat_before.st_size != expected_size or stat_before.st_mtime_ns != expected_modified_ns:
            raise ValueError(f"源文件在导出前发生了变化：{source.name}")

        info = zipfile.ZipInfo.from_file(
            source,
            arcname=archive_name,
            strict_timestamps=False,
        )
        info.compress_type = (
            zipfile.ZIP_STORED
            if source.suffix.casefold() in STORED_IMAGE_SUFFIXES
            else zipfile.ZIP_DEFLATED
        )
        digest = hashlib.sha256()
        with (
            source.open("rb") as source_handle,
            archive.open(
                info,
                mode="w",
                force_zip64=True,
            ) as archive_handle,
        ):
            chunk_number = 0
            while chunk := source_handle.read(COPY_CHUNK_SIZE):
                digest.update(chunk)
                archive_handle.write(chunk)
                chunk_number += 1
                if chunk_number % STOP_CHECK_INTERVAL_CHUNKS == 0:
                    self._check_stop(repository, operation_id)

        stat_after = source.stat()
        if (
            stat_before.st_size,
            stat_before.st_mtime_ns,
        ) != (
            stat_after.st_size,
            stat_after.st_mtime_ns,
        ):
            raise ValueError(f"源文件在打包过程中发生了变化：{source.name}")
        if digest.hexdigest() != expected_hash:
            raise ValueError(f"源文件内容与项目索引不一致，请重新扫描：{source.name}")
        self._check_stop(repository, operation_id)
        return expected_size

    def _write_payload_to_archive(
        self,
        archive: zipfile.ZipFile,
        archive_name: str,
        payload: bytes,
        *,
        expected_hash: str,
        operation_id: str,
        repository: ExportRepository,
    ) -> int:
        if hashlib.sha256(payload).hexdigest() != expected_hash:
            raise ValueError("导出标注快照校验失败。")
        self._check_stop(repository, operation_id)
        archive.writestr(
            archive_name,
            payload,
            compress_type=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        )
        self._check_stop(repository, operation_id)
        return len(payload)

    def _process_item(
        self,
        workspace_root: Path,
        destination: Path,
        operation_id: str,
        item,
        repository: ExportRepository,
    ) -> int:
        root = workspace_root.resolve()
        artifacts = self._artifacts(item)
        published: list[Path] = []
        copied_bytes = 0
        try:
            for artifact in artifacts:
                self._check_stop(repository, operation_id)
                target = self._required_target(
                    destination,
                    str(artifact["target_relative_path"]),
                )
                target.parent.mkdir(parents=True, exist_ok=True)
                if str(artifact["kind"]) == "image":
                    source_relative = artifact.get("source_relative_path")
                    if not source_relative:
                        raise ValueError("导出图片快照缺少源路径。")
                    source = (root / str(source_relative)).resolve()
                    if not source.is_relative_to(root):
                        raise ValueError("图片路径超出当前项目范围。")
                    copied_bytes += self._copy_verified(
                        source,
                        target,
                        expected_hash=str(artifact["content_hash"]),
                        expected_size=int(artifact["byte_size"]),
                        expected_modified_ns=int(artifact["source_modified_ns"]),
                        operation_id=operation_id,
                        repository=repository,
                    )
                else:
                    payload = self._artifact_payload(artifact)
                    copied_bytes += self._write_payload(
                        target,
                        payload,
                        expected_hash=str(artifact["content_hash"]),
                        operation_id=operation_id,
                        repository=repository,
                    )
                published.append(target)
            return copied_bytes
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
            raise ValueError(f"导出目标已经存在：{target}")
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

    def _write_payload(
        self,
        target: Path,
        payload: bytes,
        *,
        expected_hash: str,
        operation_id: str,
        repository: ExportRepository,
    ) -> int:
        if hashlib.sha256(payload).hexdigest() != expected_hash:
            raise ValueError("导出标注快照校验失败。")
        if target.exists():
            raise ValueError(f"导出目标已经存在：{target}")
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".dataset-studio-export-{operation_id}-",
            suffix=".write",
            dir=target.parent,
        )
        temporary = Path(temporary_name)
        reserved_target = False
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            self._check_stop(repository, operation_id)
            reservation = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(reservation)
            reserved_target = True
            os.replace(temporary, target)
            reserved_target = False
            return len(payload)
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
        allowed_temporary: Path | None = None,
    ) -> None:
        if self._packaging(operation) == ExportPackaging.ZIP:
            self._validate_archive_destination(
                operation,
                items,
                require_complete=require_complete,
                allowed_temporary=allowed_temporary,
            )
            return

        destination = Path(operation.destination_path)
        if not destination.is_dir():
            raise ValueError("导出目录已经不存在或不再是文件夹。")
        self._cleanup_operation_temp_files(destination, operation.id)

        allowed_paths: set[str] = set()
        for item in items:
            completed = str(item["status"]) == "completed"
            if require_complete and not completed:
                raise ValueError("导出任务仍有未完成条目。")
            if not completed:
                continue
            for artifact in self._artifacts(item):
                relative = str(artifact["target_relative_path"])
                target = self._required_target(destination, relative)
                if not target.is_file():
                    raise ValueError(f"已导出的文件缺失，无法继续：{relative}")
                if target.stat().st_size != int(artifact["byte_size"]):
                    raise ValueError(f"已导出的文件大小发生了变化：{relative}")
                if file_sha256(target) != str(artifact["content_hash"]):
                    raise ValueError(f"已导出的文件内容发生了变化：{relative}")
                allowed_paths.add(PurePosixPath(relative).as_posix().casefold())

        try:
            files = [entry for entry in destination.rglob("*") if entry.is_file()]
        except OSError as error:
            raise ValueError(f"无法读取导出目录：{error}") from error
        unknown = [
            entry.relative_to(destination).as_posix()
            for entry in files
            if entry.relative_to(destination).as_posix().casefold() not in allowed_paths
        ]
        if unknown:
            examples = "、".join(sorted(unknown, key=str.casefold)[:5])
            raise ValueError(f"导出目录中出现了任务之外的文件：{examples}")

    def _validate_archive_destination(
        self,
        operation: ExportOperation,
        items,
        *,
        require_complete: bool,
        allowed_temporary: Path | None,
    ) -> None:
        destination = Path(operation.destination_path)
        if not destination.is_dir():
            raise ValueError("导出目录已经不存在或不再是文件夹。")
        if allowed_temporary is None:
            self._cleanup_archive_temp_files(destination, operation.id)

        if archive_output_path(destination).exists():
            raise ValueError("目标 ZIP 压缩包已经存在，无法覆盖。")
        if require_complete and any(str(item["status"]) != "completed" for item in items):
            raise ValueError("导出任务仍有未完成条目。")

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
    def _packaging(operation: ExportOperation) -> ExportPackaging:
        raw = operation.configuration_snapshot.get(
            "packaging",
            ExportPackaging.DIRECTORY.value,
        )
        try:
            return ExportPackaging(str(raw))
        except ValueError as error:
            raise ValueError("导出任务的输出方式快照无效。") from error

    @classmethod
    def _cleanup_archive_outputs(cls, operation: ExportOperation) -> None:
        destination = Path(operation.destination_path)
        cls._cleanup_archive_temp_files(destination, operation.id)
        cls._remove_owned_archive(destination, operation.id)

    @classmethod
    def _remove_owned_archive(cls, destination: Path, operation_id: str) -> None:
        archive_path = archive_output_path(destination)
        if not archive_path.is_file():
            return
        try:
            with zipfile.ZipFile(archive_path) as archive:
                owned = archive.comment == ARCHIVE_COMMENT_PREFIX + operation_id.encode("ascii")
        except (OSError, zipfile.BadZipFile):
            return
        if owned:
            archive_path.unlink(missing_ok=True)

    @staticmethod
    def _artifacts(item) -> list[dict[str, object]]:
        try:
            value = json.loads(str(item["artifact_snapshot"]))
        except (json.JSONDecodeError, TypeError) as error:
            raise ValueError("导出条目的快照无效。") from error
        if not isinstance(value, list) or not value:
            raise ValueError("导出条目没有可执行的文件快照。")
        if not all(isinstance(artifact, dict) for artifact in value):
            raise ValueError("导出条目的文件快照结构无效。")
        return value

    @staticmethod
    def _artifact_payload(artifact: dict[str, object]) -> bytes:
        raw_base64 = artifact.get("raw_base64")
        if raw_base64 is not None:
            try:
                return base64.b64decode(str(raw_base64), validate=True)
            except ValueError as error:
                raise ValueError("导出标注的二进制快照无效。") from error
        content = artifact.get("content")
        if content is None:
            raise ValueError("导出标注快照缺少内容。")
        return str(content).encode("utf-8")

    @staticmethod
    def _required_target(destination: Path, relative_path: str) -> Path:
        target = ExportWorker._safe_target(destination, relative_path)
        if target is None:
            raise ValueError("导出目标路径超出目标目录。")
        return target

    @staticmethod
    def _safe_relative_path(relative_path: str) -> PurePosixPath | None:
        pure = PurePosixPath(relative_path)
        if (
            not relative_path
            or pure.is_absolute()
            or "\\" in relative_path
            or "\x00" in relative_path
            or any(part in {"", ".", ".."} for part in relative_path.split("/"))
        ):
            return None
        return pure

    @staticmethod
    def _required_archive_name(relative_path: str) -> str:
        pure = ExportWorker._safe_relative_path(relative_path)
        if pure is None:
            raise ValueError("ZIP 归档内的目标路径无效。")
        return pure.as_posix()

    @staticmethod
    def _safe_target(destination: Path, relative_path: str) -> Path | None:
        pure = ExportWorker._safe_relative_path(relative_path)
        if pure is None:
            return None
        root = destination.resolve()
        target = (root / Path(*pure.parts)).resolve()
        return target if target.is_relative_to(root) else None

    @staticmethod
    def _archive_staging_directory(destination: Path, operation_id: str) -> Path:
        return destination / f".dataset-studio-export-{operation_id}"

    @classmethod
    def _create_archive_temporary(cls, destination: Path, operation_id: str) -> Path:
        staging = cls._archive_staging_directory(destination, operation_id)
        marker = staging / ARCHIVE_STAGING_MARKER_NAME
        temporary = staging / ARCHIVE_STAGING_FILE_NAME
        try:
            staging.mkdir(mode=0o700)
        except FileExistsError as error:
            raise ValueError(
                "检测到无法验证所有权的 ZIP 临时目录；为避免删除外部文件，任务已停止。"
            ) from error

        descriptor: int | None = None
        try:
            with marker.open("x", encoding="ascii", newline="\n") as handle:
                handle.write(operation_id)
                handle.flush()
                os.fsync(handle.fileno())
            descriptor = os.open(
                temporary,
                os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, "O_BINARY", 0),
                0o600,
            )
            os.close(descriptor)
            descriptor = None
            return temporary
        except BaseException:
            if descriptor is not None:
                with suppress(OSError):
                    os.close(descriptor)
            with suppress(OSError):
                temporary.unlink(missing_ok=True)
            with suppress(OSError):
                marker.unlink(missing_ok=True)
            with suppress(OSError):
                staging.rmdir()
            raise

    @classmethod
    def _cleanup_archive_temp_files(cls, destination: Path, operation_id: str) -> None:
        if not destination.is_dir():
            return
        staging = cls._archive_staging_directory(destination, operation_id)
        marker = staging / ARCHIVE_STAGING_MARKER_NAME
        temporary = staging / ARCHIVE_STAGING_FILE_NAME
        try:
            staging_stat = staging.lstat()
            reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            if (
                not stat.S_ISDIR(staging_stat.st_mode)
                or stat.S_ISLNK(staging_stat.st_mode)
                or bool(getattr(staging_stat, "st_file_attributes", 0) & reparse_flag)
            ):
                return

            marker_stat = marker.lstat()
            if (
                not stat.S_ISREG(marker_stat.st_mode)
                or marker_stat.st_size > 128
                or bool(getattr(marker_stat, "st_file_attributes", 0) & reparse_flag)
                or marker.read_text(encoding="ascii") != operation_id
            ):
                return

            try:
                temporary_stat = temporary.lstat()
            except FileNotFoundError:
                pass
            else:
                if not stat.S_ISREG(temporary_stat.st_mode):
                    return
                temporary.unlink()
            marker.unlink()
            with suppress(OSError):
                staging.rmdir()
        except FileNotFoundError:
            return
        except (OSError, UnicodeError) as error:
            LOGGER.warning(
                "Unable to clean archive staging for export %s: %s",
                operation_id,
                error,
            )

    @staticmethod
    def _cleanup_operation_temp_files(destination: Path, operation_id: str) -> None:
        if not destination.is_dir():
            return
        prefix = f".dataset-studio-export-{operation_id}-"
        for candidate in destination.rglob("*"):
            if candidate.is_file() and candidate.name.startswith(prefix):
                candidate.unlink(missing_ok=True)

    @staticmethod
    def _cleanup_item_targets(destination: Path, item) -> None:
        with suppress(ValueError):
            artifacts = ExportWorker._artifacts(item)
            for artifact in artifacts:
                target = ExportWorker._safe_target(
                    destination,
                    str(artifact["target_relative_path"]),
                )
                if target is not None:
                    target.unlink(missing_ok=True)
