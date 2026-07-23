from __future__ import annotations

import os
import secrets
import shutil
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

from dataset_studio.core.files import file_sha256
from dataset_studio.modules.assets.companions import AssetBundleFileKind
from dataset_studio.modules.assets.deletions.models import (
    AssetDeleteOperation,
    AssetDeletionExecuteRequest,
    AssetDeletionPreview,
    AssetDeletionRequest,
)
from dataset_studio.modules.assets.deletions.planner import build_plan, preview_token
from dataset_studio.modules.assets.deletions.repository import (
    AssetDeletionRepository,
    DeleteFileRecord,
)
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.service import WorkspaceService


class AssetDeletionService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces
        self._active_lock = threading.Lock()
        self._active_operations: set[tuple[str, str]] = set()

    def preview(
        self,
        project_id: str,
        request: AssetDeletionRequest,
    ) -> AssetDeletionPreview:
        paths, _ = self._workspaces.get(project_id)
        plan = build_plan(paths.database, paths.root, paths.internal, request)
        return AssetDeletionPreview(
            asset_count=len(request.asset_ids),
            file_count=len(plan.files),
            image_count=plan.count(AssetBundleFileKind.IMAGE),
            annotation_count=plan.count(AssetBundleFileKind.ANNOTATION),
            translation_count=plan.count(AssetBundleFileKind.TRANSLATION),
            metadata_count=plan.count(AssetBundleFileKind.METADATA),
            shared_sidecar_count=plan.shared_sidecar_count,
            warnings=list(plan.warnings),
            blocking_issues=list(plan.blocking_issues),
            preview_token=preview_token(request, plan),
        )

    def execute(
        self,
        project_id: str,
        execution: AssetDeletionExecuteRequest,
    ) -> AssetDeleteOperation:
        paths, _ = self._workspaces.get(project_id)
        operation_id = str(uuid.uuid4())
        with self._track(project_id, operation_id):
            plan = build_plan(paths.database, paths.root, paths.internal, execution.request)
            current_token = preview_token(execution.request, plan)
            if not secrets.compare_digest(current_token, execution.preview_token):
                raise ValueError("删除预览已失效；文件或选择范围发生了变化，请重新预览。")
            if plan.blocking_issues:
                raise ValueError(plan.blocking_issues[0])
            if len(plan.assets) != len(execution.request.asset_ids):
                raise ValueError("部分素材已不在当前工作区，请刷新列表后重试。")
            if plan.count(AssetBundleFileKind.IMAGE) != len(plan.assets):
                raise ValueError("部分图片已不可用，请重新扫描工作区后重试。")

            repository = AssetDeletionRepository(paths.database)
            recovery_paths = [
                (
                    paths.recovery
                    / "deletions"
                    / operation_id
                    / "files"
                    / Path(PurePosixPath(file.source_relative_path))
                )
                .relative_to(paths.root)
                .as_posix()
                for file in plan.files
            ]
            repository.start(operation_id, plan, recovery_paths)
            moved: list[DeleteFileRecord] = []
            try:
                for record in repository.files(operation_id):
                    source, recovery = self._file_paths(paths, operation_id, record)
                    self._validate_source(record, source)
                    recovery.parent.mkdir(parents=True, exist_ok=True)
                    repository.set_file_phase(record.id, "moving")
                    os.replace(source, recovery)
                    moved.append(record)
                    repository.set_file_phase(record.id, "moved")
                repository.complete(operation_id)
            except BaseException as error:
                rollback_errors = self._rollback_execution(
                    paths,
                    operation_id,
                    repository,
                    moved,
                )
                message = str(error) or type(error).__name__
                if rollback_errors:
                    repository.mark_recovery_required(
                        operation_id,
                        f"{message}；自动恢复失败：{rollback_errors[0]}",
                    )
                    raise RuntimeError("素材删除失败，且部分文件需要人工恢复。") from error
                repository.mark_failed(operation_id, message)
                shutil.rmtree(
                    paths.recovery / "deletions" / operation_id,
                    ignore_errors=True,
                )
                raise
            operation = repository.get(operation_id)
            if operation is None:
                raise RuntimeError("读取素材删除结果失败。")
            return operation

    def undo(self, project_id: str, operation_id: str) -> AssetDeleteOperation:
        paths, _ = self._workspaces.get(project_id)
        repository = AssetDeletionRepository(paths.database)
        with self._track(project_id, f"undo:{operation_id}"):
            operation = repository.get(operation_id)
            if operation is None:
                raise ValueError(f"找不到素材删除记录：{operation_id}")
            repository.begin_undo(operation_id)
            files = repository.files(operation_id)
            restored: list[DeleteFileRecord] = []
            try:
                for record in files:
                    source, recovery = self._file_paths(paths, operation_id, record)
                    self._validate_recovery(record, source, recovery)
                for record in files:
                    source, recovery = self._file_paths(paths, operation_id, record)
                    source.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(recovery, source)
                    restored.append(record)
                    repository.set_file_phase(record.id, "restored")
                repository.complete_undo(operation_id)
            except BaseException as error:
                rollback_errors = self._rollback_undo(
                    paths,
                    operation_id,
                    repository,
                    restored,
                )
                message = str(error) or type(error).__name__
                if rollback_errors:
                    repository.mark_recovery_required(
                        operation_id,
                        f"{message}；撤销回滚失败：{rollback_errors[0]}",
                    )
                    raise RuntimeError("恢复素材失败，且部分文件需要人工处理。") from error
                repository.reset_completed(operation_id, message)
                raise
            shutil.rmtree(
                paths.recovery / "deletions" / operation_id,
                ignore_errors=True,
            )
            restored_operation = repository.get(operation_id)
            if restored_operation is None:
                raise RuntimeError("读取素材恢复结果失败。")
            return restored_operation

    def list_operations(self, project_id: str, limit: int = 50) -> list[AssetDeleteOperation]:
        paths, _ = self._workspaces.get(project_id)
        return AssetDeletionRepository(paths.database).list_operations(limit)

    def recover_orphaned(self, project_id: str) -> int:
        paths, _ = self._workspaces.get(project_id)
        repository = AssetDeletionRepository(paths.database)
        recovered = 0
        for operation in repository.active_operations():
            repository.mark_recovering(operation.id)
            try:
                present, total = repository.asset_presence(operation.id)
                if total != operation.asset_count:
                    raise ValueError("素材删除恢复清单与数据库记录不一致。")
                if present == 0:
                    self._finish_interrupted_undo(paths, operation.id, repository)
                elif present == total:
                    self._restore_interrupted_execution(paths, operation.id, repository)
                else:
                    raise ValueError("素材删除涉及的数据库状态不一致，无法自动恢复。")
            except BaseException as error:
                repository.mark_recovery_required(
                    operation.id,
                    str(error) or type(error).__name__,
                )
                continue
            recovered += 1
        return recovered

    def active_overview(self) -> tuple[int, int]:
        persisted: dict[str, int] = {}
        for workspace in self._workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._workspaces.get(workspace.project_id)
            count = len(AssetDeletionRepository(paths.database).in_progress_operations())
            if count:
                persisted[workspace.project_id] = count
        with self._active_lock:
            in_memory = set(self._active_operations)
        for project_id, _ in in_memory:
            persisted.setdefault(project_id, 1)
        return sum(persisted.values()), len(persisted)

    def active_project_ids(self) -> set[str]:
        projects: set[str] = set()
        for workspace in self._workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, _ = self._workspaces.get(workspace.project_id)
            if AssetDeletionRepository(paths.database).in_progress_operations():
                projects.add(workspace.project_id)
        with self._active_lock:
            projects.update(project_id for project_id, _ in self._active_operations)
        return projects

    def has_active(self, project_id: str) -> bool:
        with self._active_lock:
            if any(
                active_project_id == project_id for active_project_id, _ in self._active_operations
            ):
                return True
        paths, _ = self._workspaces.get(project_id)
        return self.has_active_database(paths.database)

    def ensure_persisted_inactive(self, project_id: str) -> None:
        paths, _ = self._workspaces.get(project_id)
        self.ensure_database_inactive(paths.database)

    @staticmethod
    def has_active_database(database_path: Path) -> bool:
        return bool(AssetDeletionRepository(database_path).active_operations())

    @classmethod
    def ensure_database_inactive(cls, database_path: Path) -> None:
        if cls.has_active_database(database_path):
            raise ValueError("当前工作区存在尚未完成恢复的素材删除，请先完成恢复。")

    @contextmanager
    def _track(self, project_id: str, operation_id: str):
        key = (project_id, operation_id)
        with self._active_lock:
            if any(
                active_project_id == project_id for active_project_id, _ in self._active_operations
            ):
                raise ValueError("当前工作区正在删除或恢复素材，请等待操作完成。")
            self._active_operations.add(key)
        try:
            yield
        finally:
            with self._active_lock:
                self._active_operations.discard(key)

    @staticmethod
    def _file_paths(
        paths: WorkspacePaths,
        operation_id: str,
        record: DeleteFileRecord,
    ) -> tuple[Path, Path]:
        source = paths.root / Path(PurePosixPath(record.source_relative_path))
        recovery = paths.root / Path(PurePosixPath(record.recovery_relative_path))
        resolved_root = paths.root.resolve()
        resolved_internal = paths.internal.resolve()
        resolved_recovery_root = (paths.recovery / "deletions" / operation_id).resolve()
        if not source.resolve().is_relative_to(resolved_root):
            raise ValueError(f"素材路径超出当前工作区：{record.source_relative_path}")
        if source.resolve().is_relative_to(resolved_internal):
            raise ValueError(f"拒绝删除工作区内部文件：{record.source_relative_path}")
        if not recovery.resolve().is_relative_to(resolved_recovery_root):
            raise ValueError(f"恢复路径无效：{record.recovery_relative_path}")
        return source, recovery

    @staticmethod
    def _validate_source(record: DeleteFileRecord, source: Path) -> None:
        if not source.is_file():
            raise ValueError(f"待删除文件已不存在：{record.source_relative_path}")
        stat = source.stat()
        if stat.st_size != record.byte_size or stat.st_mtime_ns != record.modified_ns:
            raise ValueError(f"待删除文件在预览后发生了变化：{record.source_relative_path}")
        if file_sha256(source) != record.content_hash:
            raise ValueError(f"待删除文件内容发生了变化：{record.source_relative_path}")

    @staticmethod
    def _validate_recovery(
        record: DeleteFileRecord,
        source: Path,
        recovery: Path,
    ) -> None:
        if source.exists():
            raise ValueError(f"原位置已经出现同名文件，拒绝覆盖：{record.source_relative_path}")
        if not recovery.is_file():
            raise ValueError(f"恢复文件缺失：{record.recovery_relative_path}")
        if file_sha256(recovery) != record.content_hash:
            raise ValueError(f"恢复文件校验失败：{record.recovery_relative_path}")

    def _rollback_execution(
        self,
        paths: WorkspacePaths,
        operation_id: str,
        repository: AssetDeletionRepository,
        moved: list[DeleteFileRecord],
    ) -> list[str]:
        errors: list[str] = []
        for record in reversed(moved):
            try:
                source, recovery = self._file_paths(paths, operation_id, record)
                if source.exists():
                    raise ValueError(f"原位置已出现文件：{record.source_relative_path}")
                if recovery.is_file():
                    source.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(recovery, source)
                repository.set_file_phase(record.id, "restored")
            except Exception as error:
                errors.append(str(error) or type(error).__name__)
        return errors

    def _rollback_undo(
        self,
        paths: WorkspacePaths,
        operation_id: str,
        repository: AssetDeletionRepository,
        restored: list[DeleteFileRecord],
    ) -> list[str]:
        errors: list[str] = []
        for record in reversed(restored):
            try:
                source, recovery = self._file_paths(paths, operation_id, record)
                if recovery.exists():
                    raise ValueError(f"恢复区已出现同名文件：{record.recovery_relative_path}")
                recovery.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, recovery)
                repository.set_file_phase(record.id, "moved")
            except Exception as error:
                errors.append(str(error) or type(error).__name__)
        return errors

    def _restore_interrupted_execution(
        self,
        paths: WorkspacePaths,
        operation_id: str,
        repository: AssetDeletionRepository,
    ) -> None:
        for record in reversed(repository.files(operation_id)):
            source, recovery = self._file_paths(paths, operation_id, record)
            if source.exists() and recovery.exists():
                raise ValueError(f"源文件与恢复文件同时存在：{record.source_relative_path}")
            if recovery.is_file():
                source.parent.mkdir(parents=True, exist_ok=True)
                os.replace(recovery, source)
            elif not source.is_file():
                raise ValueError(f"源文件与恢复文件均缺失：{record.source_relative_path}")
            repository.set_file_phase(record.id, "restored")
        repository.mark_failed(operation_id, "应用中断，删除内容已自动恢复。")
        shutil.rmtree(paths.recovery / "deletions" / operation_id, ignore_errors=True)

    def _finish_interrupted_undo(
        self,
        paths: WorkspacePaths,
        operation_id: str,
        repository: AssetDeletionRepository,
    ) -> None:
        for record in repository.files(operation_id):
            source, recovery = self._file_paths(paths, operation_id, record)
            if source.exists() and recovery.exists():
                raise ValueError(f"源文件与恢复文件同时存在：{record.source_relative_path}")
            if recovery.is_file():
                source.parent.mkdir(parents=True, exist_ok=True)
                os.replace(recovery, source)
            elif not source.is_file():
                raise ValueError(f"源文件与恢复文件均缺失：{record.source_relative_path}")
            repository.set_file_phase(record.id, "restored")
        repository.complete_undo(operation_id)
        shutil.rmtree(paths.recovery / "deletions" / operation_id, ignore_errors=True)
