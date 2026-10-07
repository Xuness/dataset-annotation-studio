from __future__ import annotations

import secrets
import shutil
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.assets.scanner import AssetScanner
from dataset_studio.modules.cropping.execution import recover_orphaned as recover_crops
from dataset_studio.modules.preprocessing import file_operations
from dataset_studio.modules.preprocessing.executor import (
    PreparedItem,
    PreprocessItemPreparer,
    requires_render,
    resolve_resize_worker_count,
)
from dataset_studio.modules.preprocessing.models import (
    ImageProcessingBackend,
    ImageProcessingBackends,
    PreprocessExecuteRequest,
    PreprocessExecutionPlan,
    PreprocessExecutionPlanItem,
    PreprocessExecutionPlanRequest,
    PreprocessItemPhase,
    PreprocessOperation,
    PreprocessPreview,
    PreprocessPreviewItem,
    PreprocessRequest,
)
from dataset_studio.modules.preprocessing.planner import PlanItem, build_plan, preview_token
from dataset_studio.modules.preprocessing.publication import commit_prepared_item
from dataset_studio.modules.preprocessing.recovery import (
    PreprocessRecoveryCoordinator,
    RecoveryFileOperations,
)
from dataset_studio.modules.preprocessing.repository import PreprocessRepository
from dataset_studio.modules.preprocessing.runtime.contracts import RenderIntent
from dataset_studio.modules.preprocessing.runtime.inspection import inspect_image
from dataset_studio.modules.preprocessing.runtime.registry import ImageBackendRegistry
from dataset_studio.modules.preprocessing.runtime.router import build_routing_plan
from dataset_studio.modules.workspaces.service import WorkspaceService


class PreprocessService:
    _record_item = staticmethod(file_operations._record_item)
    _verify_undo = staticmethod(file_operations._verify_undo)
    _update_asset = staticmethod(file_operations._update_asset)
    _rollback = staticmethod(file_operations._rollback)
    _restore_file = staticmethod(file_operations._restore_file)
    _sidecar_paths = staticmethod(file_operations._sidecar_paths)
    _translation_languages = staticmethod(file_operations._translation_languages)
    _claimed_annotation_paths = staticmethod(file_operations._claimed_annotation_paths)
    _path_key = staticmethod(file_operations._path_key)
    _same_file = staticmethod(file_operations._same_file)
    _restore_executed_sidecars = staticmethod(file_operations._restore_executed_sidecars)
    _restore_original_sidecars = staticmethod(file_operations._restore_original_sidecars)
    _backup_current_sidecars = staticmethod(file_operations._backup_current_sidecars)
    _undo_sidecars = staticmethod(file_operations._undo_sidecars)
    _restore_processed_sidecars = staticmethod(file_operations._restore_processed_sidecars)

    def _undo_item(self, root: Path, database: Path, item: sqlite3.Row, backup: Path) -> None:
        file_operations._undo_item(root, database, item, backup, self._update_asset)

    def _restore_processed_item(
        self, root: Path, database: Path, item: sqlite3.Row, backup: Path
    ) -> None:
        file_operations._restore_processed_item(root, database, item, backup, self._update_asset)

    def __init__(
        self,
        workspaces: WorkspaceService,
        *,
        has_active_jobs: Callable[[str], bool] | None = None,
        has_active_exports: Callable[[str], bool] | None = None,
        has_active_asset_deletions: Callable[[str], bool] | None = None,
        has_active_screening: Callable[[str], bool] | None = None,
        backend_registry: ImageBackendRegistry | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._has_active_jobs = has_active_jobs or (lambda _project_id: False)
        self._has_active_exports = has_active_exports or (lambda _project_id: False)
        self._has_active_asset_deletions = has_active_asset_deletions or (lambda _project_id: False)
        self._has_active_screening = has_active_screening or (lambda _project_id: False)
        self._scanner = AssetScanner()
        self._backend_registry = backend_registry or ImageBackendRegistry()
        self._recovery = PreprocessRecoveryCoordinator(
            workspaces,
            self._scanner,
            RecoveryFileOperations(
                same_file=self._same_file,
                claimed_annotation_paths=self._claimed_annotation_paths,
                sidecar_paths=self._sidecar_paths,
                update_asset=self._update_asset,
            ),
        )
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

    def image_processing_backends(self) -> ImageProcessingBackends:
        descriptors = self._backend_registry.descriptors()
        return ImageProcessingBackends(
            revision=self._backend_registry.revision(),
            backends=[
                ImageProcessingBackend(
                    id=descriptor.id,
                    kind=descriptor.kind,
                    label=descriptor.label,
                    status=descriptor.status,
                    device_name=descriptor.device_name,
                    total_memory_bytes=descriptor.total_memory_bytes,
                    supports_batch=descriptor.supports_batch,
                    decode_formats=list(descriptor.decode_formats),
                    encode_formats=list(descriptor.encode_formats),
                    resize_algorithms=list(descriptor.resize_algorithms),
                    issue=descriptor.issue,
                )
                for descriptor in descriptors
            ],
        )

    def execution_plan(
        self,
        project_id: str,
        payload: PreprocessExecutionPlanRequest,
    ) -> PreprocessExecutionPlan:
        paths, _ = self._workspaces.get(project_id)
        plan = build_plan(paths.database, paths.root, payload.request)
        current_token = preview_token(payload.request, plan)
        if not secrets.compare_digest(current_token, payload.preview_token):
            raise ValueError("预览已失效；参数或源文件发生了变化，请重新预览。")
        render_items = [
            item for item in plan if item.will_change and requires_render(item, payload.request)
        ]
        intents = [
            RenderIntent(
                plan=item,
                descriptor=inspect_image(paths.root / item.before_relative_path),
                resize=payload.request.resize,
                convert=payload.request.convert,
            )
            for item in render_items
        ]
        routing = build_routing_plan(
            intents,
            payload.execution,
            self._backend_registry,
            worker_count=resolve_resize_worker_count(
                render_items,
                payload.request,
                payload.execution,
            ),
        )
        visible = routing.decisions[:2000]
        return PreprocessExecutionPlan(
            items=[
                PreprocessExecutionPlanItem(
                    asset_id=decision.intent.plan.asset_id,
                    route=decision.route,
                    backend_id=decision.backend_id,
                    reason_code=decision.reason_code,
                )
                for decision in visible
            ],
            total_render_items=len(routing.decisions),
            truncated=len(visible) < len(routing.decisions),
            selected_backend_id=routing.selected_backend_id,
            route_counts=routing.route_counts,
            route_reasons=routing.reason_counts,
            effective_cpu_workers=routing.worker_count,
            effective_batch_size=routing.batch_size,
            capability_revision=self._backend_registry.revision(),
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
            changed_items = [item for item in plan if item.will_change]
            repository.start(
                operation_id,
                request,
                execution.execution,
                len(changed_items),
            )
            operation_root = paths.recovery / operation_id
            started = time.perf_counter()
            try:
                with PreprocessItemPreparer(
                    root=paths.root,
                    operation_root=operation_root,
                    items=changed_items,
                    request=request,
                    execution=execution.execution,
                    backend_registry=self._backend_registry,
                ) as preparer:
                    for prepared in preparer:
                        item_id = self._record_item(
                            repository,
                            paths.root,
                            operation_id,
                            prepared,
                        )
                        repository.set_item_phase(
                            item_id,
                            PreprocessItemPhase.COMMITTING.value,
                        )
                        self._commit_prepared_item(paths, prepared)
                        completed.append((prepared.plan, prepared.recovery_path))
                        repository.set_item_phase(
                            item_id,
                            PreprocessItemPhase.COMMITTED.value,
                        )
                    runtime = preparer.runtime_summary(
                        round((time.perf_counter() - started) * 1000)
                    )
                self._scanner.scan(paths, manifest)
                repository.complete(operation_id, runtime)
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
            finally:
                shutil.rmtree(operation_root / "staging", ignore_errors=True)
        operation = repository.get(operation_id)
        if operation is None:
            raise RuntimeError("预处理操作记录创建失败。")
        return operation

    def list_operations(self, project_id: str) -> list[PreprocessOperation]:
        paths, _ = self._workspaces.get(project_id)
        with connect(paths.database) as connection:
            crop_ids = {str(r[0]) for r in connection.execute("SELECT id FROM crop_operations")}
        return [
            operation
            for operation in PreprocessRepository(paths.database).list()
            if operation.id not in crop_ids
        ]

    def recover_orphaned(self) -> int:
        return recover_crops(self._workspaces) + self._recovery.recover_orphaned()

    def close(self) -> None:
        self._backend_registry.close()

    def undo(self, project_id: str, operation_id: str) -> PreprocessOperation:
        paths, manifest = self._workspaces.get(project_id)
        repository = PreprocessRepository(paths.database)
        with self._track_operation(project_id, f"undo:{operation_id}"):
            self._ensure_no_active_jobs(project_id)
            with connect(paths.database) as connection:
                if connection.execute(
                    "SELECT 1 FROM crop_operations WHERE id=?", (operation_id,)
                ).fetchone():
                    raise ValueError("此操作属于非破坏性裁剪，请从裁剪历史撤销。")
            operation = repository.get(operation_id)
            if operation is None:
                raise ValueError("找不到预处理操作。")
            if operation.status != "completed":
                raise ValueError("只有已完成且尚未撤销的操作可以恢复。")
            if repository.latest_completed_id() != operation_id:
                raise ValueError(
                    "只能从最新的一次图片操作开始依次撤销；较新的裁剪请从裁剪历史撤销。"
                )
            items = list(repository.items(operation_id))
            self._verify_undo(paths.root, paths.database, items)
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

    def _commit_prepared_item(self, paths, prepared: PreparedItem) -> None:
        commit_prepared_item(self, paths, prepared)

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

    def ensure_persisted_inactive(self, project_id: str) -> None:
        paths, _ = self._workspaces.get(project_id)
        self.ensure_database_inactive(paths.database)

    @staticmethod
    def has_active_database(database_path: Path) -> bool:
        connection = connect(database_path)
        try:
            active = connection.execute(
                """
                SELECT 1 FROM preprocess_operations
                WHERE status IN ('running', 'recovering')
                LIMIT 1
                """
            ).fetchone()
        finally:
            connection.close()
        return active is not None

    @classmethod
    def ensure_database_inactive(cls, database_path: Path) -> None:
        if cls.has_active_database(database_path):
            with connect(database_path) as connection:
                crop = connection.execute(
                    "SELECT id,error FROM crop_operations "
                    "WHERE status='recovery_failed' OR (status='undoing' AND error IS NOT NULL) "
                    "ORDER BY created_at DESC LIMIT 1"
                ).fetchone()
            if crop:
                raise ValueError(
                    f"当前项目的裁剪恢复尚未完成：operation={crop['id']}；{crop['error']}。"
                    "请查看预处理页的裁剪记录，修复文件问题后重新启动应用以重试恢复。"
                )
            raise ValueError("当前工作区存在尚未结束或尚未恢复的图片预处理，请稍后重试。")

    def _ensure_no_active_jobs(self, project_id: str) -> None:
        if self._has_active_jobs(project_id):
            raise ValueError("当前工作区仍有标注或翻译任务运行，请先停止任务再修改图片文件。")
        if self._has_active_exports(project_id):
            raise ValueError("当前工作区正在导出数据，请先停止导出任务再修改图片文件。")
        if self._has_active_asset_deletions(project_id):
            raise ValueError("当前工作区正在删除或恢复素材，请等待操作完成。")
        if self._has_active_screening(project_id):
            raise ValueError("当前工作区正在筛选图片，请先停止筛选任务再修改图片文件。")

    @contextmanager
    def guard_workspace(self, project_id: str, operation_id: str):
        with self._track_operation(project_id, operation_id, is_preprocessing=False):
            yield

    @contextmanager
    def guard_image_operation(self, project_id: str, operation_id: str) -> Iterator[None]:
        with self._track_operation(project_id, operation_id, is_preprocessing=True):
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
