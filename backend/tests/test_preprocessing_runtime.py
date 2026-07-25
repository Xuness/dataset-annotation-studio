from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

from PIL import Image

from dataset_studio.core.config import Settings
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.preprocessing.image_pipeline import render_image_to_staging
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecuteRequest,
    PreprocessExecutionMode,
    PreprocessExecutionOptions,
    PreprocessExecutionPlanRequest,
    PreprocessRequest,
    PreprocessRoute,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.planner import PlanItem
from dataset_studio.modules.preprocessing.runtime.contracts import (
    BackendAssessment,
    BackendDescriptor,
    BackendRenderError,
    ImageDescriptor,
    RenderIntent,
    RenderObservation,
    RenderResult,
    RenderTask,
)
from dataset_studio.modules.preprocessing.runtime.cuda_backend import CudaImageBackend
from dataset_studio.modules.preprocessing.service import PreprocessService
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import initialize_global_database


class _FakeAccelerator:
    def __init__(self, descriptor: BackendDescriptor, *, failing_name: str | None = None) -> None:
        self._descriptor = descriptor
        self._failing_name = failing_name
        self.batch_sizes: list[int] = []

    @property
    def descriptor(self) -> BackendDescriptor:
        return self._descriptor

    def assess(self, intent: RenderIntent) -> BackendAssessment:
        if not intent.resize_needed:
            return BackendAssessment(
                route=PreprocessRoute.CPU,
                supported=False,
                reason_code="no_accelerated_stage",
            )
        return BackendAssessment(
            route=PreprocessRoute.ACCELERATED_RESIZE,
            supported=True,
        )

    def render_batch(self, tasks: Sequence[RenderTask]) -> list[RenderResult]:
        self.batch_sizes.append(len(tasks))
        failing = [
            task
            for task in tasks
            if task.decision.intent.plan.before_relative_path == self._failing_name
        ]
        if failing and len(tasks) > 1:
            raise BackendRenderError(
                "fake_batch_failed",
                "simulated accelerator batch failure",
                retry_smaller_batch=True,
            )

        results: list[RenderResult] = []
        for task in tasks:
            intent = task.decision.intent
            if intent.plan.before_relative_path == self._failing_name:
                task.staging.parent.mkdir(parents=True, exist_ok=True)
                task.staging.write_bytes(b"not an image")
            else:
                render_image_to_staging(
                    task.source,
                    task.staging,
                    intent.plan,
                    intent.resize,
                    intent.convert,
                )
            results.append(
                RenderResult(
                    task=task,
                    observation=RenderObservation(
                        planned_route=task.decision.route,
                        actual_route=PreprocessRoute.ACCELERATED_RESIZE,
                        backend_id=self._descriptor.id,
                        decode_location="cpu",
                        resize_location="accelerator",
                        encode_location="cpu",
                        duration_ms=1,
                    ),
                )
            )
        return results

    def close(self) -> None:
        return None


class _FakeRegistry:
    def __init__(
        self,
        *,
        failing_name: str | None = None,
        fail_initialization: bool = False,
    ) -> None:
        self._fail_initialization = fail_initialization
        self.cpu = BackendDescriptor(
            id="cpu",
            kind="cpu",
            label="CPU",
            status="ready",
            supports_batch=True,
            decode_formats=("jpeg", "png"),
            encode_formats=("jpeg", "png"),
            resize_algorithms=("lanczos3",),
        )
        self.accelerator = BackendDescriptor(
            id="test:0",
            kind="test",
            label="Test Accelerator",
            status="degraded",
            device_name="Synthetic Device",
            total_memory_bytes=8 * 1024**3,
            supports_batch=True,
            decode_formats=("jpeg",),
            encode_formats=("jpeg",),
            resize_algorithms=("lanczos3",),
            issue="Codec unavailable; resize remains usable.",
        )
        self.backend = _FakeAccelerator(
            self.accelerator,
            failing_name=failing_name,
        )

    def descriptors(self, *, refresh: bool = False) -> tuple[BackendDescriptor, ...]:
        del refresh
        return self.cpu, self.accelerator

    def revision(self) -> str:
        return "test-capability-revision"

    def ready_accelerators(self) -> tuple[BackendDescriptor, ...]:
        return (self.accelerator,)

    def descriptor(self, backend_id: str) -> BackendDescriptor | None:
        return next(
            (descriptor for descriptor in self.descriptors() if descriptor.id == backend_id),
            None,
        )

    def get(self, backend_id: str) -> _FakeAccelerator:
        if backend_id != self.accelerator.id:
            raise ValueError(backend_id)
        if self._fail_initialization:
            raise RuntimeError("simulated accelerator initialization failure")
        return self.backend

    def close(self) -> None:
        self.backend.close()


def _services(
    tmp_path: Path,
    registry: _FakeRegistry,
) -> tuple[WorkspaceService, PreprocessService]:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    workspaces = WorkspaceService(settings, WorkspaceRegistry(global_database))
    return workspaces, PreprocessService(
        workspaces,
        backend_registry=registry,
    )


def test_cuda_assessment_preserves_partial_acceleration_and_reports_missing_codec() -> None:
    backend = object.__new__(CudaImageBackend)
    backend._nvimgcodec = None
    backend._decoder = None
    backend._encoder = None
    plan = PlanItem(
        asset_id="sample",
        before_relative_path="sample.jpg",
        after_relative_path="sample.jpg",
        before_width=320,
        before_height=160,
        after_width=64,
        after_height=32,
        before_hash="test",
        will_change=True,
        warning=None,
    )
    descriptor = ImageDescriptor(
        codec="jpeg",
        mode="RGB",
        bit_depth=8,
        has_alpha=False,
        is_animated=False,
        exif_orientation=1,
        is_progressive=True,
    )
    intent = RenderIntent(
        plan=plan,
        descriptor=descriptor,
        resize=ResizeOptions(max_edge=64),
        convert=None,
    )

    assessment = backend.assess(intent)

    assert assessment.supported is True
    assert assessment.route == PreprocessRoute.ACCELERATED_RESIZE

    codec_only = backend.assess(
        replace(
            intent,
            plan=replace(plan, after_width=320, after_height=160),
            descriptor=replace(descriptor, is_progressive=False),
            resize=None,
        )
    )
    assert codec_only.supported is False
    assert codec_only.reason_code == "cuda_codec_unavailable"


def test_capabilities_and_execution_plan_are_dynamic_and_advisory(tmp_path: Path) -> None:
    registry = _FakeRegistry()
    workspaces, preprocessing = _services(tmp_path, registry)
    project = tmp_path / "dataset"
    project.mkdir()
    for index in range(3):
        Image.new("RGB", (320, 160), (index * 40, 100, 180)).save(project / f"{index}.jpg")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    preview = preprocessing.preview(summary.project_id, request)

    capabilities = preprocessing.image_processing_backends()
    assert capabilities.revision == "test-capability-revision"
    assert [backend.id for backend in capabilities.backends] == ["cpu", "test:0"]
    assert capabilities.backends[1].device_name == "Synthetic Device"

    automatic = preprocessing.execution_plan(
        summary.project_id,
        PreprocessExecutionPlanRequest(
            request=request,
            preview_token=preview.preview_token,
            execution=PreprocessExecutionOptions(mode=PreprocessExecutionMode.AUTO),
        ),
    )
    assert automatic.selected_backend_id == "cpu"
    assert automatic.route_counts == {"cpu": 3}
    assert automatic.route_reasons == {"workload_too_small": 3}

    accelerated = preprocessing.execution_plan(
        summary.project_id,
        PreprocessExecutionPlanRequest(
            request=request,
            preview_token=preview.preview_token,
            execution=PreprocessExecutionOptions(
                mode=PreprocessExecutionMode.PREFER_ACCELERATOR,
                accelerator_id="test:0",
                batch_size=3,
            ),
        ),
    )
    assert accelerated.selected_backend_id == "test:0"
    assert accelerated.route_counts == {"accelerated_resize": 3}
    assert accelerated.effective_batch_size == 3
    assert all(item.backend_id == "test:0" for item in accelerated.items)

    automatic_operation = preprocessing.execute(
        summary.project_id,
        PreprocessExecuteRequest(
            request=request,
            preview_token=preview.preview_token,
            execution=PreprocessExecutionOptions(mode=PreprocessExecutionMode.AUTO),
        ),
    )
    assert automatic_operation.runtime is not None
    assert automatic_operation.runtime.route_counts == {"cpu": 3}
    assert automatic_operation.runtime.route_reason_counts == {"workload_too_small": 3}
    assert automatic_operation.runtime.fallback_counts == {}


def test_accelerator_initialization_failure_routes_the_operation_to_cpu(
    tmp_path: Path,
) -> None:
    registry = _FakeRegistry(fail_initialization=True)
    workspaces, preprocessing = _services(tmp_path, registry)
    project = tmp_path / "dataset"
    project.mkdir()
    Image.new("RGB", (320, 160), (80, 120, 180)).save(project / "sample.jpg")
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    preview = preprocessing.preview(summary.project_id, request)
    execution = PreprocessExecutionOptions(
        mode=PreprocessExecutionMode.PREFER_ACCELERATOR,
        accelerator_id="test:0",
    )

    operation = preprocessing.execute(
        summary.project_id,
        PreprocessExecuteRequest(
            request=request,
            preview_token=preview.preview_token,
            execution=execution,
        ),
    )

    assert operation.status == "completed"
    assert operation.runtime is not None
    assert operation.runtime.selected_backend_id == "cpu"
    assert operation.runtime.route_counts == {"cpu": 1}
    assert operation.runtime.route_reason_counts == {"accelerator_initialization_failed": 1}
    assert operation.runtime.fallback_counts == {}


def test_accelerator_batch_failure_is_split_and_only_failed_item_falls_back(
    tmp_path: Path,
) -> None:
    registry = _FakeRegistry(failing_name="bad.jpg")
    workspaces, preprocessing = _services(tmp_path, registry)
    project = tmp_path / "dataset"
    project.mkdir()
    for index, name in enumerate(("good-a.jpg", "bad.jpg", "good-b.jpg")):
        Image.new("RGB", (320, 160), (index * 40, 100, 180)).save(project / name)
    summary, _ = workspaces.open(str(project))
    request = PreprocessRequest(resize=ResizeOptions(max_edge=64))
    preview = preprocessing.preview(summary.project_id, request)
    execution = PreprocessExecutionOptions(
        mode=PreprocessExecutionMode.PREFER_ACCELERATOR,
        accelerator_id="test:0",
        max_workers=2,
        batch_size=3,
    )

    operation = preprocessing.execute(
        summary.project_id,
        PreprocessExecuteRequest(
            request=request,
            preview_token=preview.preview_token,
            execution=execution,
        ),
    )

    assert operation.status == "completed"
    assert operation.execution == execution
    assert operation.runtime is not None
    assert operation.runtime.selected_backend_id == "test:0"
    assert operation.runtime.route_counts == {
        "accelerated_resize": 2,
        "cpu": 1,
    }
    assert operation.runtime.route_reason_counts == {}
    assert operation.runtime.fallback_counts == {"invalid_accelerator_output": 1}
    assert registry.backend.batch_sizes[0] == 3
    assert 1 in registry.backend.batch_sizes
    for name in ("good-a.jpg", "bad.jpg", "good-b.jpg"):
        with Image.open(project / name) as image:
            assert image.size == (64, 32)

    paths, _ = workspaces.get(summary.project_id)
    with connect(paths.database) as connection:
        rows = {
            str(row["before_relative_path"]): row
            for row in connection.execute(
                """
                SELECT before_relative_path, planned_route, actual_route,
                       backend_id, fallback_code
                FROM preprocess_items
                WHERE operation_id = ?
                """,
                (operation.id,),
            )
        }
    assert set(rows) == {"good-a.jpg", "bad.jpg", "good-b.jpg"}
    assert all(row["planned_route"] == "accelerated_resize" for row in rows.values())
    assert rows["bad.jpg"]["actual_route"] == "cpu"
    assert rows["bad.jpg"]["backend_id"] == "cpu"
    assert rows["bad.jpg"]["fallback_code"] == "invalid_accelerator_output"
    for name in ("good-a.jpg", "good-b.jpg"):
        assert rows[name]["actual_route"] == "accelerated_resize"
        assert rows[name]["backend_id"] == "test:0"
        assert rows[name]["fallback_code"] is None
