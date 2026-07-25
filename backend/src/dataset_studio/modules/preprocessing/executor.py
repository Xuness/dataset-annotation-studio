from __future__ import annotations

import logging
import os
import threading
from collections import Counter
from collections.abc import Callable, Iterator, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path

from PIL import Image

from dataset_studio.core.files import atomic_copy_file_with_sha256
from dataset_studio.modules.preprocessing.image_pipeline import (
    render_image_to_staging,
    sha256,
)
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecutionOptions,
    PreprocessExecutionRuntime,
    PreprocessRequest,
    PreprocessRoute,
)
from dataset_studio.modules.preprocessing.planner import PlanItem
from dataset_studio.modules.preprocessing.runtime.contracts import (
    BackendRenderError,
    RenderIntent,
    RenderObservation,
    RenderResult,
    RenderTask,
    RouteDecision,
)
from dataset_studio.modules.preprocessing.runtime.cpu_backend import CpuImageBackend
from dataset_studio.modules.preprocessing.runtime.inspection import inspect_image
from dataset_studio.modules.preprocessing.runtime.registry import ImageBackendRegistry
from dataset_studio.modules.preprocessing.runtime.router import (
    ExecutionRoutingPlan,
    build_routing_plan,
)

_AUTO_WORKER_LIMIT = 8
_IN_FLIGHT_PIXEL_BUDGET = 160_000_000
LOGGER = logging.getLogger("dataset_studio.preprocessing")
_EXPECTED_FORMAT_BY_SUFFIX = {
    ".bmp": "BMP",
    ".jpeg": "JPEG",
    ".jpg": "JPEG",
    ".png": "PNG",
    ".tif": "TIFF",
    ".tiff": "TIFF",
    ".webp": "WEBP",
}


@dataclass(frozen=True, slots=True)
class PreparedItem:
    plan: PlanItem
    recovery_path: Path
    staging_path: Path | None
    after_hash: str
    source_size: int
    source_modified_ns: int
    observation: RenderObservation | None = None


@dataclass(frozen=True, slots=True)
class _SourceSnapshot:
    plan: PlanItem
    recovery_path: Path
    staging_path: Path | None
    source_size: int
    source_modified_ns: int
    copied_hash: str


@dataclass(frozen=True, slots=True)
class _RenderedOutput:
    result: RenderResult
    after_hash: str


def requires_render(item: PlanItem, request: PreprocessRequest) -> bool:
    return (
        item.before_width != item.after_width
        or item.before_height != item.after_height
        or request.convert is not None
    )


def resolve_resize_worker_count(
    items: Sequence[PlanItem],
    request: PreprocessRequest,
    execution: PreprocessExecutionOptions,
) -> int:
    render_items = [item for item in items if requires_render(item, request)]
    if not render_items:
        return 1

    logical_cpus = os.cpu_count() or 1
    automatic_workers = min(_AUTO_WORKER_LIMIT, max(1, logical_cpus // 2))
    requested_workers = execution.max_workers or automatic_workers
    largest_pixel_cost = max(
        item.before_width * item.before_height * 2 + item.after_width * item.after_height
        for item in render_items
    )
    memory_limited_workers = max(1, _IN_FLIGHT_PIXEL_BUDGET // largest_pixel_cost)
    return max(
        1,
        min(
            requested_workers,
            memory_limited_workers,
            len(render_items),
        ),
    )


class PreprocessItemPreparer:
    """Prepare immutable outputs while leaving workspace commits serialized."""

    def __init__(
        self,
        *,
        root: Path,
        operation_root: Path,
        items: Sequence[PlanItem],
        request: PreprocessRequest,
        execution: PreprocessExecutionOptions,
        backend_registry: ImageBackendRegistry,
    ) -> None:
        self._root = root
        self._operation_root = operation_root
        self._items = tuple(items)
        self._request = request
        self._execution = execution
        self._backend_registry = backend_registry
        self._worker_count = resolve_resize_worker_count(self._items, request, execution)
        self._cpu_pool: ThreadPoolExecutor | None = None
        self._accelerator_pool: ThreadPoolExecutor | None = None
        self._futures: list[Future[object]] = []
        self._iterated = False
        self._routing_plan: ExecutionRoutingPlan | None = None
        self._observations: list[RenderObservation] = []
        self._accelerator_disabled_code: str | None = None
        self._accelerator_state_lock = threading.Lock()

    @property
    def worker_count(self) -> int:
        return self._worker_count

    @property
    def routing_plan(self) -> ExecutionRoutingPlan | None:
        return self._routing_plan

    def __enter__(self) -> PreprocessItemPreparer:
        if any(requires_render(item, self._request) for item in self._items):
            self._cpu_pool = ThreadPoolExecutor(
                max_workers=self._worker_count,
                thread_name_prefix="preprocess-resize",
            )
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        for future in self._futures:
            future.cancel()
        if self._accelerator_pool is not None:
            self._accelerator_pool.shutdown(wait=True, cancel_futures=True)
            self._accelerator_pool = None
        if self._cpu_pool is not None:
            self._cpu_pool.shutdown(wait=True, cancel_futures=True)
            self._cpu_pool = None
        self._futures.clear()

    def __iter__(self) -> Iterator[PreparedItem]:
        if self._iterated:
            raise RuntimeError("预处理准备器不能重复迭代。")
        self._iterated = True
        snapshots = self._prepare_snapshots()
        render_snapshots = [snapshot for snapshot in snapshots if snapshot.staging_path is not None]
        intents = [
            RenderIntent(
                plan=snapshot.plan,
                descriptor=inspect_image(snapshot.recovery_path),
                resize=self._request.resize,
                convert=self._request.convert,
            )
            for snapshot in render_snapshots
        ]
        self._routing_plan = build_routing_plan(
            intents,
            self._execution,
            self._backend_registry,
            worker_count=self._worker_count,
        )
        decision_by_asset = {
            decision.intent.plan.asset_id: decision for decision in self._routing_plan.decisions
        }
        rendered = self._schedule_rendering(render_snapshots, decision_by_asset)

        for snapshot in snapshots:
            if snapshot.staging_path is None:
                yield PreparedItem(
                    plan=snapshot.plan,
                    recovery_path=snapshot.recovery_path,
                    staging_path=None,
                    after_hash=snapshot.copied_hash,
                    source_size=snapshot.source_size,
                    source_modified_ns=snapshot.source_modified_ns,
                )
                continue
            output = rendered[snapshot.plan.asset_id]()
            self._observations.append(output.result.observation)
            yield PreparedItem(
                plan=snapshot.plan,
                recovery_path=snapshot.recovery_path,
                staging_path=snapshot.staging_path,
                after_hash=output.after_hash,
                source_size=snapshot.source_size,
                source_modified_ns=snapshot.source_modified_ns,
                observation=output.result.observation,
            )

    def runtime_summary(self, duration_ms: int) -> PreprocessExecutionRuntime:
        routing = self._routing_plan
        if routing is None:
            raise RuntimeError("预处理执行统计只能在准备器开始迭代后读取。")
        return PreprocessExecutionRuntime(
            requested_mode=self._execution.mode,
            selected_backend_id=routing.selected_backend_id,
            backend_label=routing.backend_label,
            route_counts=dict(
                Counter(observation.actual_route.value for observation in self._observations)
            ),
            route_reason_counts=dict(
                Counter(
                    observation.route_reason_code
                    for observation in self._observations
                    if observation.route_reason_code is not None
                )
            ),
            fallback_counts=dict(
                Counter(
                    observation.fallback_code
                    for observation in self._observations
                    if observation.fallback_code is not None
                )
            ),
            worker_count=routing.worker_count,
            batch_size=routing.batch_size,
            duration_ms=max(0, duration_ms),
        )

    def _prepare_snapshots(self) -> list[_SourceSnapshot]:
        if self._cpu_pool is None:
            return [self._snapshot_item(item) for item in self._items]
        futures = [self._cpu_pool.submit(self._snapshot_item, item) for item in self._items]
        self._futures.extend(futures)
        return [future.result() for future in futures]

    def _snapshot_item(self, item: PlanItem) -> _SourceSnapshot:
        source = self._root / item.before_relative_path
        recovery = self._operation_root / "files" / Path(item.before_relative_path)
        stat_before = source.stat()
        try:
            copied_hash = atomic_copy_file_with_sha256(source, recovery)
            stat_after = source.stat()
            if (
                copied_hash != item.before_hash
                or stat_before.st_size != stat_after.st_size
                or stat_before.st_mtime_ns != stat_after.st_mtime_ns
            ):
                raise ValueError(f"源文件在预处理准备期间发生了变化：{item.before_relative_path}")
            staging = None
            if requires_render(item, self._request):
                target_suffix = Path(item.after_relative_path).suffix
                staging = self._operation_root / "staging" / f"{item.asset_id}{target_suffix}"
            return _SourceSnapshot(
                plan=item,
                recovery_path=recovery,
                staging_path=staging,
                source_size=stat_after.st_size,
                source_modified_ns=stat_after.st_mtime_ns,
                copied_hash=copied_hash,
            )
        except BaseException:
            recovery.unlink(missing_ok=True)
            raise

    def _schedule_rendering(
        self,
        snapshots: list[_SourceSnapshot],
        decision_by_asset: dict[str, RouteDecision],
    ) -> dict[str, Callable[[], _RenderedOutput]]:
        if not snapshots:
            return {}
        if self._cpu_pool is None or self._routing_plan is None:
            raise RuntimeError("图片渲染执行器尚未初始化。")
        cpu = CpuImageBackend(render_image_to_staging)
        task_by_asset: dict[str, RenderTask] = {}
        for snapshot in snapshots:
            if snapshot.staging_path is None:
                continue
            decision = decision_by_asset[snapshot.plan.asset_id]
            task_by_asset[snapshot.plan.asset_id] = RenderTask(
                decision=decision,
                source=snapshot.recovery_path,
                staging=snapshot.staging_path,
            )

        accessors: dict[str, Callable[[], _RenderedOutput]] = {}
        accelerated: dict[PreprocessRoute, list[RenderTask]] = {
            PreprocessRoute.ACCELERATED_FULL: [],
            PreprocessRoute.ACCELERATED_RESIZE: [],
        }
        for asset_id, task in task_by_asset.items():
            if task.decision.route == PreprocessRoute.CPU:
                future = self._cpu_pool.submit(self._render_cpu_task, cpu, task)
                self._futures.append(future)
                accessors[asset_id] = future.result
            else:
                accelerated[task.decision.route].append(task)

        if any(accelerated.values()):
            self._accelerator_pool = ThreadPoolExecutor(
                max_workers=1,
                thread_name_prefix="preprocess-accelerator",
            )
            try:
                backend = self._backend_registry.get(self._routing_plan.selected_backend_id)
            except Exception:
                LOGGER.exception(
                    "Accelerator %s could not be initialized; using CPU.",
                    self._routing_plan.selected_backend_id,
                )
                for tasks in accelerated.values():
                    for task in tasks:
                        fallback_task = self._fallback_task(
                            task,
                            "accelerator_initialization_failed",
                        )
                        future = self._cpu_pool.submit(
                            self._render_cpu_task,
                            cpu,
                            fallback_task,
                        )
                        self._futures.append(future)
                        accessors[task.decision.intent.plan.asset_id] = future.result
                return accessors
            for tasks in accelerated.values():
                for offset in range(0, len(tasks), self._routing_plan.batch_size):
                    batch = tasks[offset : offset + self._routing_plan.batch_size]
                    future = self._accelerator_pool.submit(
                        self._render_accelerated_batch,
                        backend,
                        cpu,
                        batch,
                    )
                    self._futures.append(future)
                    for index, task in enumerate(batch):
                        accessors[task.decision.intent.plan.asset_id] = (
                            lambda future=future, index=index: future.result()[index]
                        )
        return accessors

    @staticmethod
    def _render_cpu_task(
        cpu: CpuImageBackend,
        task: RenderTask,
    ) -> _RenderedOutput:
        result = cpu.render_batch([task])[0]
        return _RenderedOutput(result=result, after_hash=sha256(task.staging))

    def _render_accelerated_batch(
        self,
        backend,
        cpu: CpuImageBackend,
        tasks: list[RenderTask],
    ) -> list[_RenderedOutput]:
        with self._accelerator_state_lock:
            disabled_code = self._accelerator_disabled_code
        if disabled_code is not None:
            return self._fallback_to_cpu(cpu, tasks, disabled_code)
        try:
            results = backend.render_batch(tasks)
            if len(results) != len(tasks):
                raise BackendRenderError(
                    "incomplete_accelerator_batch",
                    "加速器后端没有返回完整批次。",
                    retry_smaller_batch=True,
                )
            for task, result in zip(tasks, results, strict=True):
                self._validate_accelerated_result(backend, task, result)
            return [
                _RenderedOutput(result=result, after_hash=sha256(result.task.staging))
                for result in results
            ]
        except BackendRenderError as error:
            for task in tasks:
                task.staging.unlink(missing_ok=True)
            log = LOGGER.warning if error.fatal or len(tasks) == 1 else LOGGER.debug
            log(
                "Accelerator batch of %s item(s) failed with %s; %s.",
                len(tasks),
                error.code,
                "using CPU" if error.fatal or len(tasks) == 1 else "splitting batch",
            )
            if error.fatal:
                with self._accelerator_state_lock:
                    self._accelerator_disabled_code = error.code
                return self._fallback_to_cpu(cpu, tasks, error.code)
            if error.retry_smaller_batch and len(tasks) > 1:
                midpoint = len(tasks) // 2
                return [
                    *self._render_accelerated_batch(backend, cpu, tasks[:midpoint]),
                    *self._render_accelerated_batch(backend, cpu, tasks[midpoint:]),
                ]
            return self._fallback_to_cpu(cpu, tasks, error.code)
        except Exception:
            LOGGER.exception(
                "Unexpected accelerator backend failure; disabling it for this operation."
            )
            for task in tasks:
                task.staging.unlink(missing_ok=True)
            with self._accelerator_state_lock:
                self._accelerator_disabled_code = "accelerator_backend_exception"
            return self._fallback_to_cpu(
                cpu,
                tasks,
                "accelerator_backend_exception",
            )

    @staticmethod
    def _validate_accelerated_result(backend, task: RenderTask, result: RenderResult) -> None:
        observation = result.observation
        if (
            result.task.decision.intent.plan.asset_id != task.decision.intent.plan.asset_id
            or result.task.source != task.source
            or result.task.staging != task.staging
            or observation.planned_route != task.decision.route
            or observation.actual_route != task.decision.route
            or observation.backend_id != backend.descriptor.id
        ):
            raise BackendRenderError(
                "invalid_accelerator_result",
                "加速器后端返回了与请求不一致的执行结果。",
                retry_smaller_batch=True,
            )
        try:
            if not task.staging.is_file() or task.staging.stat().st_size <= 0:
                raise ValueError("没有生成输出文件")
            with Image.open(task.staging) as image:
                image.load()
                expected_size = (
                    task.decision.intent.plan.after_width,
                    task.decision.intent.plan.after_height,
                )
                if image.size != expected_size:
                    raise ValueError(f"输出尺寸为 {image.size}，期望 {expected_size}")
                expected_format = _EXPECTED_FORMAT_BY_SUFFIX.get(task.staging.suffix.casefold())
                if expected_format is not None and image.format != expected_format:
                    raise ValueError(f"输出格式为 {image.format}，期望 {expected_format}")
        except (OSError, ValueError) as error:
            raise BackendRenderError(
                "invalid_accelerator_output",
                f"加速器后端生成了无效图片：{error}",
                retry_smaller_batch=True,
            ) from error

    @staticmethod
    def _fallback_to_cpu(
        cpu: CpuImageBackend,
        tasks: list[RenderTask],
        fallback_code: str,
    ) -> list[_RenderedOutput]:
        fallback_tasks = [
            PreprocessItemPreparer._fallback_task(task, fallback_code) for task in tasks
        ]
        results = cpu.render_batch(fallback_tasks)
        return [
            _RenderedOutput(result=result, after_hash=sha256(result.task.staging))
            for result in results
        ]

    @staticmethod
    def _fallback_task(task: RenderTask, fallback_code: str) -> RenderTask:
        return replace(
            task,
            decision=replace(
                task.decision,
                reason_code=fallback_code,
            ),
        )
