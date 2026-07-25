from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    PreprocessRoute,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.planner import PlanItem


@dataclass(frozen=True, slots=True)
class BackendDescriptor:
    id: str
    kind: str
    label: str
    status: str
    device_name: str | None = None
    total_memory_bytes: int | None = None
    supports_batch: bool = False
    decode_formats: tuple[str, ...] = ()
    encode_formats: tuple[str, ...] = ()
    resize_algorithms: tuple[str, ...] = ()
    issue: str | None = None


@dataclass(frozen=True, slots=True)
class ImageDescriptor:
    codec: str
    mode: str
    bit_depth: int
    has_alpha: bool
    is_animated: bool
    exif_orientation: int
    is_progressive: bool


@dataclass(frozen=True, slots=True)
class RenderIntent:
    plan: PlanItem
    descriptor: ImageDescriptor
    resize: ResizeOptions | None
    convert: ConvertOptions | None

    @property
    def resize_needed(self) -> bool:
        return (
            self.plan.before_width != self.plan.after_width
            or self.plan.before_height != self.plan.after_height
        )


@dataclass(frozen=True, slots=True)
class BackendAssessment:
    route: PreprocessRoute
    supported: bool
    reason_code: str | None = None


@dataclass(frozen=True, slots=True)
class RouteDecision:
    intent: RenderIntent
    route: PreprocessRoute
    backend_id: str
    reason_code: str | None = None


@dataclass(frozen=True, slots=True)
class RenderTask:
    decision: RouteDecision
    source: Path
    staging: Path


@dataclass(frozen=True, slots=True)
class RenderObservation:
    planned_route: PreprocessRoute
    actual_route: PreprocessRoute
    backend_id: str
    decode_location: str
    resize_location: str
    encode_location: str
    duration_ms: int
    route_reason_code: str | None = None
    fallback_code: str | None = None
    fallback_reason: str | None = None


@dataclass(frozen=True, slots=True)
class RenderResult:
    task: RenderTask
    observation: RenderObservation


class BackendRenderError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        fatal: bool = False,
        retry_smaller_batch: bool = True,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.fatal = fatal
        self.retry_smaller_batch = retry_smaller_batch


class ImageRenderBackend(Protocol):
    @property
    def descriptor(self) -> BackendDescriptor: ...

    def assess(self, intent: RenderIntent) -> BackendAssessment: ...

    def render_batch(self, tasks: Sequence[RenderTask]) -> list[RenderResult]: ...

    def close(self) -> None: ...


RenderFunction = Callable[[Path, Path, PlanItem, ResizeOptions | None, ConvertOptions | None], None]
