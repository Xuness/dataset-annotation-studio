from __future__ import annotations

import time
from collections.abc import Sequence

from dataset_studio.modules.preprocessing.models import PreprocessRoute
from dataset_studio.modules.preprocessing.runtime.contracts import (
    BackendAssessment,
    BackendDescriptor,
    ImageRenderBackend,
    RenderFunction,
    RenderIntent,
    RenderObservation,
    RenderResult,
    RenderTask,
)


class CpuImageBackend(ImageRenderBackend):
    def __init__(self, render: RenderFunction) -> None:
        self._render = render
        self._descriptor = BackendDescriptor(
            id="cpu",
            kind="cpu",
            label="CPU · Pillow / OpenCV",
            status="ready",
            supports_batch=True,
            decode_formats=("jpeg", "png", "webp", "bmp", "tiff"),
            encode_formats=("jpeg", "png", "webp", "bmp", "tiff"),
            resize_algorithms=("lanczos3", "lanczos4", "anime_low_halo"),
        )

    @property
    def descriptor(self) -> BackendDescriptor:
        return self._descriptor

    def assess(self, intent: RenderIntent) -> BackendAssessment:
        del intent
        return BackendAssessment(route=PreprocessRoute.CPU, supported=True)

    def render_batch(self, tasks: Sequence[RenderTask]) -> list[RenderResult]:
        results: list[RenderResult] = []
        for task in tasks:
            started = time.perf_counter()
            self._render(
                task.source,
                task.staging,
                task.decision.intent.plan,
                task.decision.intent.resize,
                task.decision.intent.convert,
            )
            resize_location = "cpu" if task.decision.intent.resize_needed else "none"
            results.append(
                RenderResult(
                    task=task,
                    observation=RenderObservation(
                        planned_route=task.decision.route,
                        actual_route=PreprocessRoute.CPU,
                        backend_id="cpu",
                        decode_location="cpu",
                        resize_location=resize_location,
                        encode_location="cpu",
                        duration_ms=round((time.perf_counter() - started) * 1000),
                        route_reason_code=(
                            task.decision.reason_code
                            if task.decision.route == PreprocessRoute.CPU
                            else None
                        ),
                        fallback_code=(
                            task.decision.reason_code
                            if task.decision.route != PreprocessRoute.CPU
                            else None
                        ),
                    ),
                )
            )
        return results

    def close(self) -> None:
        return None
