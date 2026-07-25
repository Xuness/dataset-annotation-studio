from __future__ import annotations

import os
import secrets
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from dataset_studio.core.files import atomic_copy_file
from dataset_studio.core.languages import LANGUAGE_PATTERN
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.assets.scanner import IMAGE_METADATA_VERSION, AssetScanner
from dataset_studio.modules.preprocessing.executor import (
    PreparedItem,
    PreprocessItemPreparer,
    requires_render,
    resolve_resize_worker_count,
)
from dataset_studio.modules.preprocessing.image_pipeline import sha256
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
    def __init__(
        self,
        workspaces: WorkspaceService,
        *,
        has_active_jobs: Callable[[str], bool] | None = None,
        has_active_exports: Callable[[str], bool] | None = None,
        has_active_asset_deletions: Callable[[str], bool] | None = None,
        backend_registry: ImageBackendRegistry | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._has_active_jobs = has_active_jobs or (lambda _project_id: False)
        self._has_active_exports = has_active_exports or (lambda _project_id: False)
        self._has_active_asset_deletions = has_active_asset_deletions or (lambda _project_id: False)
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
        return PreprocessRepository(paths.database).list()

    def recover_orphaned(self) -> int:
        return self._recovery.recover_orphaned()

    def close(self) -> None:
        self._backend_registry.close()

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
        item = prepared.plan
        source = paths.root / item.before_relative_path
        target = paths.root / item.after_relative_path
        paths_differ = item.before_relative_path != item.after_relative_path
        source_stat = source.stat()
        if (
            source_stat.st_size != prepared.source_size
            or source_stat.st_mtime_ns != prepared.source_modified_ns
        ):
            raise ValueError(f"源文件在并发准备后发生了变化：{item.before_relative_path}")
        if paths_differ and target.exists() and not self._same_file(source, target):
            raise ValueError(f"目标文件在执行前已出现，拒绝覆盖：{item.after_relative_path}")
        target_was_source = paths_differ and self._same_file(source, target)
        sidecars = self._sidecar_paths(
            source,
            target,
            prepared.recovery_path,
            self._claimed_annotation_paths(paths.database, paths.root),
        )
        sidecar_states: list[tuple[Path, Path, Path, bool]] = []
        for before_sidecar, after_sidecar, recovery_sidecar in sidecars:
            if after_sidecar.exists() and not self._same_file(before_sidecar, after_sidecar):
                raise ValueError(
                    f"目标同名伴随文件在执行前已出现，拒绝覆盖："
                    f"{after_sidecar.relative_to(paths.root)}"
                )
            existed = before_sidecar.is_file()
            if existed:
                atomic_copy_file(before_sidecar, recovery_sidecar)
            sidecar_states.append((before_sidecar, after_sidecar, recovery_sidecar, existed))
        moved_sidecars: list[tuple[Path, Path, Path]] = []
        try:
            if prepared.staging_path is not None:
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(prepared.staging_path, target)
                if paths_differ and not target_was_source:
                    source.unlink()
            elif paths_differ:
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, target)
            for before_sidecar, after_sidecar, recovery_sidecar, existed in sidecar_states:
                if existed:
                    if not before_sidecar.is_file():
                        raise ValueError(
                            f"同名伴随文件在执行期间发生了变化："
                            f"{before_sidecar.relative_to(paths.root)}"
                        )
                    if after_sidecar.exists() and not self._same_file(
                        before_sidecar, after_sidecar
                    ):
                        raise ValueError(
                            f"目标同名伴随文件在执行前已出现，拒绝覆盖："
                            f"{after_sidecar.relative_to(paths.root)}"
                        )
                    after_sidecar.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(before_sidecar, after_sidecar)
                    moved_sidecars.append((before_sidecar, after_sidecar, recovery_sidecar))
                elif before_sidecar.exists():
                    raise ValueError(
                        f"同名伴随文件在执行期间发生了变化："
                        f"{before_sidecar.relative_to(paths.root)}"
                    )
            self._update_asset(
                paths.database,
                item.asset_id,
                target,
                paths.root,
                prepared.after_hash,
                item.after_width,
                item.after_height,
            )
        except BaseException as error:
            compensation_errors: list[str] = []
            try:
                self._restore_executed_sidecars(moved_sidecars)
            except Exception as sidecar_error:
                compensation_errors.append(f"伴随文件恢复失败：{sidecar_error}")
            try:
                self._restore_file(
                    source,
                    target,
                    prepared.recovery_path,
                    paths_differ=paths_differ,
                )
            except Exception as image_error:
                compensation_errors.append(f"图片恢复失败：{image_error}")
            if compensation_errors:
                raise RuntimeError("；".join(compensation_errors)) from error
            raise

    @staticmethod
    def _record_item(
        repository,
        root: Path,
        operation_id: str,
        prepared: PreparedItem,
    ) -> str:
        item = prepared.plan
        observation = prepared.observation
        item_id = str(uuid.uuid4())
        repository.add_item(
            operation_id,
            (
                item_id,
                operation_id,
                item.asset_id,
                item.before_relative_path,
                item.after_relative_path,
                item.before_hash,
                prepared.after_hash,
                item.before_width,
                item.before_height,
                item.after_width,
                item.after_height,
                prepared.recovery_path.relative_to(root).as_posix(),
                PreprocessItemPhase.PREPARED.value,
                observation.planned_route.value if observation else None,
                observation.actual_route.value if observation else None,
                observation.backend_id if observation else None,
                observation.decode_location if observation else None,
                observation.resize_location if observation else None,
                observation.encode_location if observation else None,
                observation.route_reason_code if observation else None,
                observation.fallback_code if observation else None,
                observation.duration_ms if observation else None,
            ),
        )
        return item_id

    @staticmethod
    def _verify_undo(root: Path, database_path: Path, items) -> None:
        claimed_annotations = PreprocessService._claimed_annotation_paths(
            database_path,
            root,
        )
        for item in items:
            current = root / str(item["after_relative_path"])
            before = root / str(item["before_relative_path"])
            original = root / str(item["recovery_relative_path"])
            paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
            if not current.is_file() or sha256(current) != str(item["after_hash"]):
                raise ValueError(
                    f"当前文件已在预处理后被修改，无法安全撤销：{item['after_relative_path']}"
                )
            if not original.is_file():
                raise ValueError(f"恢复文件缺失：{item['recovery_relative_path']}")
            if (
                paths_differ
                and before.exists()
                and not PreprocessService._same_file(before, current)
            ):
                raise ValueError(f"原路径已出现新文件，拒绝覆盖：{item['before_relative_path']}")
            for before_sidecar, after_sidecar, _ in PreprocessService._sidecar_paths(
                before,
                current,
                original,
                claimed_annotations,
            ):
                if after_sidecar.exists() and not after_sidecar.is_file():
                    raise ValueError(f"当前同名伴随路径不是文件：{after_sidecar.relative_to(root)}")
                if before_sidecar.exists() and not PreprocessService._same_file(
                    before_sidecar, after_sidecar
                ):
                    raise ValueError(
                        f"原同名伴随路径已出现新文件，拒绝覆盖：{before_sidecar.relative_to(root)}"
                    )

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
        paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
        sidecars = cls._sidecar_paths(
            before,
            current,
            original,
            cls._claimed_annotation_paths(database_path, root),
        )
        atomic_copy_file(current, backup)
        cls._backup_current_sidecars(sidecars, backup)
        before_written = False
        try:
            if paths_differ and before.exists() and not cls._same_file(before, current):
                raise ValueError(f"原路径已出现新文件，拒绝覆盖：{item['before_relative_path']}")
            if paths_differ:
                current.unlink()
            atomic_copy_file(original, before)
            before_written = True
            cls._undo_sidecars(sidecars)
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
            cls._restore_processed_sidecars(sidecars, backup)
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
        original = root / str(item["recovery_relative_path"])
        paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
        if paths_differ and before.is_file() and sha256(before) != str(item["before_hash"]):
            raise RuntimeError(f"撤销补偿时原路径又被修改：{item['before_relative_path']}")
        cls._restore_processed_sidecars(
            cls._sidecar_paths(
                before,
                after,
                original,
                cls._claimed_annotation_paths(database_path, root),
            ),
            backup,
        )
        if paths_differ:
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
            translation_rows = connection.execute(
                "SELECT language FROM annotation_translations WHERE asset_id = ?",
                (asset_id,),
            ).fetchall()
            for row in translation_rows:
                language = str(row["language"])
                translation = annotation.with_name(f"{annotation.stem}.{language}.txt")
                connection.execute(
                    """
                    UPDATE annotation_translations
                    SET translation_relative_path = ?
                    WHERE asset_id = ? AND language = ?
                    """,
                    (translation.relative_to(root).as_posix(), asset_id, language),
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
            raise ValueError("当前工作区存在尚未结束或尚未恢复的图片预处理，请稍后重试。")

    def _ensure_no_active_jobs(self, project_id: str) -> None:
        if self._has_active_jobs(project_id):
            raise ValueError("当前工作区仍有标注或翻译任务运行，请先停止任务再修改图片文件。")
        if self._has_active_exports(project_id):
            raise ValueError("当前工作区正在导出数据，请先停止导出任务再修改图片文件。")
        if self._has_active_asset_deletions(project_id):
            raise ValueError("当前工作区正在删除或恢复素材，请等待操作完成。")

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
        claimed_annotations = cls._claimed_annotation_paths(database_path, root)
        for item, recovery in reversed(completed):
            try:
                after = root / item.after_relative_path
                before = root / item.before_relative_path
                bundle_errors: list[str] = []
                try:
                    cls._restore_original_sidecars(
                        cls._sidecar_paths(
                            before,
                            after,
                            recovery,
                            claimed_annotations,
                        )
                    )
                except Exception as sidecar_error:
                    bundle_errors.append(f"伴随文件恢复失败：{sidecar_error}")
                try:
                    cls._restore_file(
                        before,
                        after,
                        recovery,
                        paths_differ=item.before_relative_path != item.after_relative_path,
                    )
                except Exception as image_error:
                    bundle_errors.append(f"图片恢复失败：{image_error}")
                if bundle_errors:
                    raise RuntimeError("；".join(bundle_errors))
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
    def _restore_file(
        before: Path,
        after: Path,
        recovery: Path,
        *,
        paths_differ: bool,
    ) -> None:
        if paths_differ:
            after.unlink(missing_ok=True)
        atomic_copy_file(recovery, before)

    @staticmethod
    def _sidecar_paths(
        before_image: Path,
        after_image: Path,
        recovery_image: Path,
        claimed_annotations: set[str],
    ) -> list[tuple[Path, Path, Path]]:
        paths: list[tuple[Path, Path, Path]] = [
            (
                before_image.with_suffix(".txt"),
                after_image.with_suffix(".txt"),
                recovery_image.with_suffix(".txt"),
            ),
            (
                before_image.with_suffix(".json"),
                after_image.with_suffix(".json"),
                recovery_image.with_suffix(".json"),
            ),
        ]
        languages = (
            PreprocessService._translation_languages(before_image, claimed_annotations)
            | PreprocessService._translation_languages(after_image, claimed_annotations)
            | PreprocessService._translation_languages(recovery_image, set())
        )
        for language in sorted(languages):
            paths.append(
                (
                    before_image.with_name(f"{before_image.stem}.{language}.txt"),
                    after_image.with_name(f"{after_image.stem}.{language}.txt"),
                    recovery_image.with_name(f"{recovery_image.stem}.{language}.txt"),
                )
            )
        return [
            (before, after, recovery)
            for before, after, recovery in paths
            if before.as_posix() != after.as_posix()
        ]

    @staticmethod
    def _translation_languages(
        image_path: Path,
        claimed_annotations: set[str],
    ) -> set[str]:
        if not image_path.parent.is_dir():
            return set()
        prefix = f"{image_path.stem}."
        languages: set[str] = set()
        for candidate in image_path.parent.glob(f"{image_path.stem}.*.txt"):
            if PreprocessService._path_key(candidate) in claimed_annotations:
                continue
            language = candidate.name[len(prefix) : -len(".txt")]
            if LANGUAGE_PATTERN.fullmatch(language):
                languages.add(language)
        return languages

    @staticmethod
    def _claimed_annotation_paths(database_path: Path, root: Path) -> set[str]:
        connection = connect(database_path)
        try:
            return {
                PreprocessService._path_key(root / str(row["annotation_relative_path"]))
                for row in connection.execute(
                    """
                    SELECT annotation_relative_path
                    FROM assets
                    WHERE is_present = 1
                    """
                )
            }
        finally:
            connection.close()

    @staticmethod
    def _path_key(path: Path) -> str:
        return filesystem_path_key(path)

    @staticmethod
    def _same_file(first: Path, second: Path) -> bool:
        if not first.exists() or not second.exists():
            return False
        try:
            return first.samefile(second)
        except OSError:
            return False

    @staticmethod
    def _restore_executed_sidecars(sidecars: list[tuple[Path, Path, Path]]) -> None:
        for before, after, recovery in reversed(sidecars):
            after.unlink(missing_ok=True)
            atomic_copy_file(recovery, before)

    @staticmethod
    def _restore_original_sidecars(sidecars: list[tuple[Path, Path, Path]]) -> None:
        for before, after, recovery in sidecars:
            if recovery.is_file():
                after.unlink(missing_ok=True)
                atomic_copy_file(recovery, before)

    @staticmethod
    def _backup_current_sidecars(
        sidecars: list[tuple[Path, Path, Path]],
        backup_image: Path,
    ) -> None:
        for _, after, _ in sidecars:
            backup = backup_image.parent / after.name
            if after.is_file():
                atomic_copy_file(after, backup)
            else:
                backup.unlink(missing_ok=True)

    @staticmethod
    def _undo_sidecars(sidecars: list[tuple[Path, Path, Path]]) -> None:
        for before, after, recovery in sidecars:
            if after.is_file():
                before.parent.mkdir(parents=True, exist_ok=True)
                os.replace(after, before)
            elif recovery.is_file():
                atomic_copy_file(recovery, before)

    @staticmethod
    def _restore_processed_sidecars(
        sidecars: list[tuple[Path, Path, Path]],
        backup_image: Path,
    ) -> None:
        for before, after, recovery in sidecars:
            backup = backup_image.parent / after.name
            if not backup.is_file() and not recovery.is_file():
                continue
            before.unlink(missing_ok=True)
            if backup.is_file():
                atomic_copy_file(backup, after)
