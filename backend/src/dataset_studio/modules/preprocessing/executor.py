from __future__ import annotations

import os
from collections.abc import Iterator, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.files import atomic_copy_file_with_sha256
from dataset_studio.modules.preprocessing.image_pipeline import (
    render_image_to_staging,
    sha256,
)
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecutionOptions,
    PreprocessRequest,
)
from dataset_studio.modules.preprocessing.planner import PlanItem

_AUTO_WORKER_LIMIT = 8
_IN_FLIGHT_PIXEL_BUDGET = 160_000_000


@dataclass(frozen=True, slots=True)
class PreparedItem:
    plan: PlanItem
    recovery_path: Path
    staging_path: Path | None
    after_hash: str
    source_size: int
    source_modified_ns: int


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
    """Prepare immutable image outputs concurrently without mutating workspace files."""

    def __init__(
        self,
        *,
        root: Path,
        operation_root: Path,
        items: Sequence[PlanItem],
        request: PreprocessRequest,
        execution: PreprocessExecutionOptions,
    ) -> None:
        self._root = root
        self._operation_root = operation_root
        self._items = tuple(items)
        self._request = request
        self._worker_count = resolve_resize_worker_count(self._items, request, execution)
        self._pool: ThreadPoolExecutor | None = None
        self._futures: dict[int, Future[PreparedItem]] = {}
        self._iterated = False

    @property
    def worker_count(self) -> int:
        return self._worker_count

    def __enter__(self) -> PreprocessItemPreparer:
        if self._worker_count > 1:
            self._pool = ThreadPoolExecutor(
                max_workers=self._worker_count,
                thread_name_prefix="preprocess-resize",
            )
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        for future in self._futures.values():
            future.cancel()
        if self._pool is not None:
            self._pool.shutdown(wait=True, cancel_futures=True)
            self._pool = None
        self._futures.clear()

    def __iter__(self) -> Iterator[PreparedItem]:
        if self._iterated:
            raise RuntimeError("预处理准备器不能重复迭代。")
        self._iterated = True
        if self._pool is None:
            for item in self._items:
                yield self._prepare_item(item)
            return

        render_indexes = iter(
            index for index, item in enumerate(self._items) if requires_render(item, self._request)
        )

        def fill_pending() -> None:
            while len(self._futures) < self._worker_count:
                try:
                    index = next(render_indexes)
                except StopIteration:
                    return
                self._futures[index] = self._pool.submit(
                    self._prepare_item,
                    self._items[index],
                )

        fill_pending()
        for index, item in enumerate(self._items):
            if not requires_render(item, self._request):
                yield self._prepare_item(item)
                continue
            future = self._futures.pop(index)
            prepared = future.result()
            fill_pending()
            yield prepared

    def _prepare_item(self, item: PlanItem) -> PreparedItem:
        source = self._root / item.before_relative_path
        recovery = self._operation_root / "files" / Path(item.before_relative_path)
        staging: Path | None = None
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

            if requires_render(item, self._request):
                target_suffix = Path(item.after_relative_path).suffix
                staging = self._operation_root / "staging" / f"{item.asset_id}{target_suffix}"
                render_image_to_staging(
                    recovery,
                    staging,
                    item,
                    self._request.resize,
                    self._request.convert,
                )
                after_hash = sha256(staging)
            else:
                after_hash = item.before_hash

            return PreparedItem(
                plan=item,
                recovery_path=recovery,
                staging_path=staging,
                after_hash=after_hash,
                source_size=stat_after.st_size,
                source_modified_ns=stat_after.st_mtime_ns,
            )
        except BaseException:
            if staging is not None:
                staging.unlink(missing_ok=True)
            recovery.unlink(missing_ok=True)
            raise
