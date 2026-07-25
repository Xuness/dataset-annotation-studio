from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass

from dataset_studio.modules.preprocessing.models import (
    PreprocessExecutionMode,
    PreprocessExecutionOptions,
    PreprocessRoute,
)
from dataset_studio.modules.preprocessing.runtime.contracts import (
    BackendDescriptor,
    RenderIntent,
    RouteDecision,
)
from dataset_studio.modules.preprocessing.runtime.registry import ImageBackendRegistry

_AUTO_MIN_RENDER_ITEMS = 8
_AUTO_MIN_SOURCE_PIXELS = 16_000_000
_DEFAULT_ACCELERATOR_BATCH_SIZE = 32
_MAX_AUTOMATIC_BATCH_SIZE = 64
_ACCELERATOR_MEMORY_SHARE = 0.15
_MAX_ACCELERATOR_MEMORY_BUDGET = 2 * 1024**3
_MIN_ACCELERATOR_MEMORY_BUDGET = 256 * 1024**2
LOGGER = logging.getLogger("dataset_studio.preprocessing")


@dataclass(frozen=True, slots=True)
class ExecutionRoutingPlan:
    decisions: tuple[RouteDecision, ...]
    selected_backend_id: str
    backend_label: str
    worker_count: int
    batch_size: int

    @property
    def route_counts(self) -> dict[str, int]:
        return dict(Counter(decision.route.value for decision in self.decisions))

    @property
    def reason_counts(self) -> dict[str, int]:
        return dict(
            Counter(
                decision.reason_code
                for decision in self.decisions
                if decision.reason_code is not None
            )
        )


def build_routing_plan(
    intents: list[RenderIntent],
    execution: PreprocessExecutionOptions,
    registry: ImageBackendRegistry,
    *,
    worker_count: int,
) -> ExecutionRoutingPlan:
    if not intents:
        return _cpu_plan(
            intents,
            worker_count=worker_count,
            batch_size=_batch_size(intents, execution, None),
        )
    accelerator = _select_accelerator(execution, registry)
    batch_size = _batch_size(intents, execution, accelerator)
    if execution.mode == PreprocessExecutionMode.CPU_ONLY:
        return _cpu_plan(
            intents,
            worker_count=worker_count,
            batch_size=batch_size,
        )
    if accelerator is None:
        return _cpu_plan(
            intents,
            worker_count=worker_count,
            batch_size=batch_size,
            reason_code="accelerator_unavailable",
        )
    if (
        execution.mode == PreprocessExecutionMode.AUTO
        and len(intents) < _AUTO_MIN_RENDER_ITEMS
        and sum(intent.plan.before_width * intent.plan.before_height for intent in intents)
        < _AUTO_MIN_SOURCE_PIXELS
    ):
        return _cpu_plan(
            intents,
            worker_count=worker_count,
            batch_size=batch_size,
            reason_code="workload_too_small",
        )

    try:
        backend = registry.get(accelerator.id)
    except Exception:
        LOGGER.exception(
            "Accelerator %s could not be initialized while planning; using CPU.",
            accelerator.id,
        )
        return _cpu_plan(
            intents,
            worker_count=worker_count,
            batch_size=batch_size,
            reason_code="accelerator_initialization_failed",
        )
    decisions: list[RouteDecision] = []
    for intent in intents:
        assessment = backend.assess(intent)
        if assessment.supported:
            decisions.append(
                RouteDecision(
                    intent=intent,
                    route=assessment.route,
                    backend_id=accelerator.id,
                )
            )
        else:
            decisions.append(
                RouteDecision(
                    intent=intent,
                    route=PreprocessRoute.CPU,
                    backend_id="cpu",
                    reason_code=assessment.reason_code or "unsupported_route",
                )
            )
    return ExecutionRoutingPlan(
        decisions=tuple(decisions),
        selected_backend_id=accelerator.id,
        backend_label=accelerator.label,
        worker_count=worker_count,
        batch_size=batch_size,
    )


def _select_accelerator(
    execution: PreprocessExecutionOptions,
    registry: ImageBackendRegistry,
) -> BackendDescriptor | None:
    if execution.mode == PreprocessExecutionMode.CPU_ONLY:
        return None
    if execution.accelerator_id:
        descriptor = registry.descriptor(execution.accelerator_id)
        if (
            descriptor is not None
            and descriptor.status in {"ready", "degraded"}
            and descriptor.id != "cpu"
        ):
            return descriptor
        return None
    return next(iter(registry.ready_accelerators()), None)


def _cpu_plan(
    intents: list[RenderIntent],
    *,
    worker_count: int,
    batch_size: int,
    reason_code: str | None = None,
) -> ExecutionRoutingPlan:
    return ExecutionRoutingPlan(
        decisions=tuple(
            RouteDecision(
                intent=intent,
                route=PreprocessRoute.CPU,
                backend_id="cpu",
                reason_code=reason_code,
            )
            for intent in intents
        ),
        selected_backend_id="cpu",
        backend_label="CPU · Pillow / OpenCV",
        worker_count=worker_count,
        batch_size=batch_size,
    )


def _batch_size(
    intents: list[RenderIntent],
    execution: PreprocessExecutionOptions,
    accelerator: BackendDescriptor | None,
) -> int:
    if execution.batch_size is not None:
        return execution.batch_size
    if accelerator is None or not intents:
        return _DEFAULT_ACCELERATOR_BATCH_SIZE
    largest_cost = max(_estimated_device_bytes(intent) for intent in intents)
    if largest_cost <= 0:
        return _DEFAULT_ACCELERATOR_BATCH_SIZE
    if accelerator.total_memory_bytes is None:
        memory_batch = _DEFAULT_ACCELERATOR_BATCH_SIZE
    else:
        budget = min(
            _MAX_ACCELERATOR_MEMORY_BUDGET,
            max(
                _MIN_ACCELERATOR_MEMORY_BUDGET,
                int(accelerator.total_memory_bytes * _ACCELERATOR_MEMORY_SHARE),
            ),
        )
        memory_batch = max(1, budget // largest_cost)
    return max(1, min(_MAX_AUTOMATIC_BATCH_SIZE, memory_batch))


def _estimated_device_bytes(intent: RenderIntent) -> int:
    channels = 4 if intent.descriptor.has_alpha else 3
    source = intent.plan.before_width * intent.plan.before_height * channels
    horizontal = intent.plan.before_height * intent.plan.after_width * channels * 4
    output = intent.plan.after_width * intent.plan.after_height * channels
    return source + horizontal + output
