from __future__ import annotations

import secrets
import shutil
import threading
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from dataset_studio.core.files import atomic_copy_file
from dataset_studio.core.sqlite import transaction
from dataset_studio.modules.assets.scanner import IMAGE_METADATA_VERSION, AssetScanner
from dataset_studio.modules.preprocessing.image_pipeline import render_image, sha256
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecuteRequest,
    PreprocessOperation,
    PreprocessPreview,
    PreprocessPreviewItem,
    PreprocessRequest,
)
from dataset_studio.modules.preprocessing.planner import PlanItem, build_plan, preview_token
from dataset_studio.modules.preprocessing.repository import PreprocessRepository
from dataset_studio.modules.workspaces.service import WorkspaceService


class PreprocessService:
    def __init__(
        self,
        workspaces: WorkspaceService,
        *,
        has_active_jobs: Callable[[str], bool] | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._has_active_jobs = has_active_jobs or (lambda _project_id: False)
        self._scanner = AssetScanner()
        self._active_lock = threading.Lock()
        self._active_operations: dict[tuple[str, str], bool] = {}

    def preview(self, project_id: str, request: PreprocessRequest) -> PreprocessPreview:
        paths, _ = self._workspaces.get(project_id)
        plan = build_plan(paths.database, paths.root, request)
        visible_plan = plan[:1000]
        visible_ids = {item.asset_id for item in visible_plan}
        visible_plan.extend(
            item for item in plan if item.warning and item.asset_id not in visible_ids
        )
        visible_plan = visible_plan[:2000]
        return PreprocessPreview(
            items=[PreprocessPreviewItem(**asdict(item)) for item in visible_plan],
            total_items=len(plan),
            truncated=len(visible_plan) < len(plan),
            changed_count=sum(item.will_change for item in plan),
            unchanged_count=sum(not item.will_change for item in plan),
            warning_count=sum(item.warning is not None for item in plan),
            preview_token=preview_token(request, plan),
        )

    def execute(
        self,
        project_id: str,
        execution: PreprocessExecuteRequest,
    ) -> PreprocessOperation:
        request = execution.request
        paths, manifest = self._workspaces.get(project_id)
        operation_id = str(uuid.uuid4())
        repository = PreprocessRepository(paths.database)
        completed: list[tuple[PlanItem, Path]] = []
        with self._track_operation(project_id, operation_id):
            self._ensure_no_active_jobs(project_id)
            plan = build_plan(paths.database, paths.root, request)
            current_token = preview_token(request, plan)
            if not secrets.compare_digest(current_token, execution.preview_token):
                raise ValueError("预览已失效；参数或源文件发生了变化，请重新预览。")
            warning = next((item.warning for item in plan if item.warning), None)
            if warning:
                raise ValueError(warning)
            if not any(item.will_change for item in plan):
                raise ValueError("当前参数不会修改任何图片，无需执行预处理。")
            repository.start(operation_id, request)
            try:
                for item in plan:
                    if item.will_change:
                        recovery = self._execute_item(paths, operation_id, item, request)
                        completed.append((item, recovery))
                        self._record_item(repository, paths.root, operation_id, item, recovery)
                repository.complete(operation_id)
                self._scanner.scan(paths, manifest)
            except Exception as error:
                compensation_errors: list[str] = []
                try:
                    self._rollback(paths.root, paths.database, completed)
                except Exception as rollback_error:
                    compensation_errors.append(f"文件回滚失败：{rollback_error}")
                try:
                    repository.fail(operation_id, str(error))
                except Exception as record_error:
                    compensation_errors.append(f"失败状态写入失败：{record_error}")
                try:
                    self._scanner.scan(paths, manifest)
                except Exception as scan_error:
                    compensation_errors.append(f"回滚后扫描失败：{scan_error}")
                if compensation_errors:
                    details = "；".join(compensation_errors)
                    raise RuntimeError(f"预处理失败，且补偿未完全完成：{details}") from error
                raise
        operation = repository.get(operation_id)
        if operation is None:
            raise RuntimeError("预处理操作记录创建失败。")
        return operation

    def list_operations(self, project_id: str) -> list[PreprocessOperation]:
        paths, _ = self._workspaces.get(project_id)
        return PreprocessRepository(paths.database).list()

    def undo(self, project_id: str, operation_id: str) -> PreprocessOperation:
        paths, manifest = self._workspaces.get(project_id)
        repository = PreprocessRepository(paths.database)
        with self._track_operation(project_id, f"undo:{operation_id}"):
            self._ensure_no_active_jobs(project_id)
            operation = repository.get(operation_id)
            if operation is None:
                raise ValueError("找不到预处理操作。")
            if operation.status != "completed":
                raise ValueError("只有已完成且尚未撤销的操作可以恢复。")
            if repository.latest_completed_id() != operation_id:
                raise ValueError("只能从最新的一次预处理开始依次撤销。")
            items = list(repository.items(operation_id))
            self._verify_undo(paths.root, items)
            backup_root = paths.recovery / operation_id / "undo-backup"
            completed: list[tuple[object, Path]] = []
            try:
                for item in items:
                    backup = backup_root / Path(str(item["after_relative_path"]))
                    self._undo_item(paths.root, paths.database, item, backup)
                    completed.append((item, backup))
                self._scanner.scan(paths, manifest)
                repository.mark_undone(operation_id)
            except Exception as error:
                compensation_errors: list[str] = []
                for completed_item, backup in reversed(completed):
                    try:
                        self._restore_processed_item(
                            paths.root,
                            paths.database,
                            completed_item,
                            backup,
                        )
                    except Exception as restore_error:
                        compensation_errors.append(str(restore_error))
                try:
                    self._scanner.scan(paths, manifest)
                except Exception as scan_error:
                    compensation_errors.append(f"补偿后扫描失败：{scan_error}")
                if compensation_errors:
                    details = "；".join(compensation_errors)
                    raise RuntimeError(f"撤销失败，且补偿未完全完成：{details}") from error
                raise
            else:
                shutil.rmtree(backup_root, ignore_errors=True)
        updated = repository.get(operation_id)
        if updated is None:
            raise RuntimeError("预处理操作记录丢失。")
        return updated

    def _execute_item(self, paths, operation_id, item, request) -> Path:
        source = paths.root / item.before_relative_path
        target = paths.root / item.after_relative_path
        if sha256(source) != item.before_hash:
            raise ValueError(f"源文件在预览后发生了变化，请重新预览：{item.before_relative_path}")
        if source.resolve() != target.resolve() and target.exists():
            raise ValueError(f"目标文件在执行前已出现，拒绝覆盖：{item.after_relative_path}")
        recovery = paths.recovery / operation_id / "files" / Path(item.before_relative_path)
        atomic_copy_file(source, recovery)
        try:
            render_image(source, target, item, request.convert)
            self._update_asset(
                paths.database,
                item.asset_id,
                target,
                paths.root,
                sha256(target),
                item.after_width,
                item.after_height,
            )
        except BaseException:
            self._restore_file(source, target, recovery)
            raise
        return recovery

    @staticmethod
    def _record_item(repository, root, operation_id, item, recovery) -> None:
        target = root / item.after_relative_path
        repository.add_item(
            operation_id,
            (
                str(uuid.uuid4()),
                operation_id,
                item.asset_id,
                item.before_relative_path,
                item.after_relative_path,
                item.before_hash,
                sha256(target),
                item.before_width,
                item.before_height,
                item.after_width,
                item.after_height,
                recovery.relative_to(root).as_posix(),
            ),
        )

    @staticmethod
    def _verify_undo(root: Path, items) -> None:
        for item in items:
            current = root / str(item["after_relative_path"])
            before = root / str(item["before_relative_path"])
            original = root / str(item["recovery_relative_path"])
            if not current.is_file() or sha256(current) != str(item["after_hash"]):
                raise ValueError(
                    f"当前文件已在预处理后被修改，无法安全撤销：{item['after_relative_path']}"
                )
            if not original.is_file():
                raise ValueError(f"恢复文件缺失：{item['recovery_relative_path']}")
            if before.resolve() != current.resolve() and before.exists():
                raise ValueError(f"原路径已出现新文件，拒绝覆盖：{item['before_relative_path']}")

    @classmethod
    def _undo_item(
        cls,
        root: Path,
        database_path: Path,
        item,
        backup: Path,
    ) -> None:
        current = root / str(item["after_relative_path"])
        before = root / str(item["before_relative_path"])
        original = root / str(item["recovery_relative_path"])
        paths_differ = before.resolve() != current.resolve()
        atomic_copy_file(current, backup)
        before_written = False
        try:
            if paths_differ and before.exists():
                raise ValueError(f"原路径已出现新文件，拒绝覆盖：{item['before_relative_path']}")
            atomic_copy_file(original, before)
            before_written = True
            if paths_differ:
                current.unlink()
            cls._update_asset(
                database_path,
                str(item["asset_id"]),
                before,
                root,
                str(item["before_hash"]),
                int(item["before_width"]),
                int(item["before_height"]),
            )
        except BaseException:
            if before_written and paths_differ:
                before.unlink(missing_ok=True)
            atomic_copy_file(backup, current)
            raise

    @classmethod
    def _restore_processed_item(
        cls,
        root: Path,
        database_path: Path,
        item,
        backup: Path,
    ) -> None:
        after = root / str(item["after_relative_path"])
        before = root / str(item["before_relative_path"])
        if before.resolve() != after.resolve():
            if before.is_file() and sha256(before) != str(item["before_hash"]):
                raise RuntimeError(f"撤销补偿时原路径又被修改：{item['before_relative_path']}")
            before.unlink(missing_ok=True)
        atomic_copy_file(backup, after)
        cls._update_asset(
            database_path,
            str(item["asset_id"]),
            after,
            root,
            str(item["after_hash"]),
            int(item["after_width"]),
            int(item["after_height"]),
        )

    @staticmethod
    def _update_asset(
        database_path: Path,
        asset_id: str,
        image_path: Path,
        root: Path,
        content_hash: str,
        width: int,
        height: int,
    ) -> None:
        stat = image_path.stat()
        annotation = image_path.with_suffix(".txt")
        metadata = image_path.with_suffix(".json")
        with transaction(database_path) as connection:
            connection.execute(
                """
                UPDATE assets
                SET relative_path = ?, filename = ?, stem = ?, suffix = ?,
                    content_hash = ?, byte_size = ?, modified_ns = ?, width = ?, height = ?,
                    annotation_relative_path = ?, metadata_relative_path = ?,
                    image_metadata_version = ?, is_present = 1
                WHERE id = ?
                """,
                (
                    image_path.relative_to(root).as_posix(),
                    image_path.name,
                    image_path.stem,
                    image_path.suffix.lower(),
                    content_hash,
                    stat.st_size,
                    stat.st_mtime_ns,
                    width,
                    height,
                    annotation.relative_to(root).as_posix(),
                    metadata.relative_to(root).as_posix() if metadata.is_file() else None,
                    IMAGE_METADATA_VERSION,
                    asset_id,
                ),
            )

    def active_overview(self) -> tuple[int, int]:
        with self._active_lock:
            operations = {
                key for key, is_preprocessing in self._active_operations.items() if is_preprocessing
            }
        return len(operations), len({project_id for project_id, _ in operations})

    def active_project_ids(self, *, preprocessing_only: bool = False) -> set[str]:
        with self._active_lock:
            return {
                project_id
                for (project_id, _), is_preprocessing in self._active_operations.items()
                if is_preprocessing or not preprocessing_only
            }

    def is_project_active(self, project_id: str) -> bool:
        return project_id in self.active_project_ids()

    def _ensure_no_active_jobs(self, project_id: str) -> None:
        if self._has_active_jobs(project_id):
            raise ValueError("当前工作区仍有标注任务运行，请先停止任务再修改图片文件。")

    @contextmanager
    def guard_workspace(self, project_id: str, operation_id: str):
        with self._track_operation(project_id, operation_id, is_preprocessing=False):
            yield

    @contextmanager
    def _track_operation(
        self,
        project_id: str,
        operation_id: str,
        *,
        is_preprocessing: bool = True,
    ):
        key = (project_id, operation_id)
        with self._active_lock:
            project_is_active = any(
                active_project_id == project_id for active_project_id, _ in self._active_operations
            )
            if project_is_active:
                raise ValueError("当前工作区正在执行图片预处理或扫描，请等待操作完成。")
            self._active_operations[key] = is_preprocessing
        try:
            yield
        finally:
            with self._active_lock:
                self._active_operations.pop(key, None)

    @classmethod
    def _rollback(
        cls,
        root: Path,
        database_path: Path,
        completed: list[tuple[PlanItem, Path]],
    ) -> None:
        errors: list[str] = []
        for item, recovery in reversed(completed):
            try:
                after = root / item.after_relative_path
                before = root / item.before_relative_path
                cls._restore_file(before, after, recovery)
                cls._update_asset(
                    database_path,
                    item.asset_id,
                    before,
                    root,
                    item.before_hash,
                    item.before_width,
                    item.before_height,
                )
            except Exception as error:
                errors.append(f"{item.before_relative_path}：{error}")
        if errors:
            raise RuntimeError("；".join(errors))

    @staticmethod
    def _restore_file(before: Path, after: Path, recovery: Path) -> None:
        if before.resolve() != after.resolve():
            after.unlink(missing_ok=True)
        atomic_copy_file(recovery, before)
