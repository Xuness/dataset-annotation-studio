from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import pytest
from PIL import Image

from dataset_studio.core.files import file_sha256
from dataset_studio.modules.preprocessing.executor import PreprocessItemPreparer
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    OutputFormat,
    PreprocessExecutionMode,
    PreprocessExecutionOptions,
    PreprocessRequest,
    PreprocessRoute,
    ResizeAlgorithm,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.planner import PlanItem
from dataset_studio.modules.preprocessing.runtime.contracts import (
    RenderIntent,
    RenderTask,
    RouteDecision,
)
from dataset_studio.modules.preprocessing.runtime.cuda_backend import (
    CudaImageBackend,
    probe_cuda_descriptors,
)
from dataset_studio.modules.preprocessing.runtime.inspection import inspect_image
from dataset_studio.modules.preprocessing.runtime.registry import ImageBackendRegistry

pytestmark = pytest.mark.skipif(
    os.environ.get("DATASET_STUDIO_RUN_CUDA_TESTS") != "1",
    reason="set DATASET_STUDIO_RUN_CUDA_TESTS=1 to exercise a real CUDA device",
)


def _plan(
    *,
    asset_id: str,
    source: Path,
    target: Path,
    before_size: tuple[int, int],
    after_size: tuple[int, int],
) -> PlanItem:
    return PlanItem(
        asset_id=asset_id,
        before_relative_path=source.name,
        after_relative_path=target.name,
        before_width=before_size[0],
        before_height=before_size[1],
        after_width=after_size[0],
        after_height=after_size[1],
        before_hash="integration-test",
        will_change=True,
        warning=None,
    )


def test_real_cuda_backend_handles_full_jpeg_and_alpha_resize(tmp_path: Path) -> None:
    descriptors = probe_cuda_descriptors()
    ready = next((descriptor for descriptor in descriptors if descriptor.status == "ready"), None)
    assert ready is not None, [descriptor.issue for descriptor in descriptors]
    backend = CudaImageBackend(ready)
    try:
        resize = ResizeOptions(max_edge=64, algorithm=ResizeAlgorithm.LANCZOS3)

        jpeg_tasks: list[RenderTask] = []
        jpeg_outputs: list[tuple[Path, tuple[int, int]]] = []
        for asset_id, raw_size, display_size, target_size, color, orientation in (
            (
                "landscape",
                (320, 160),
                (320, 160),
                (64, 32),
                (80, 140, 220),
                None,
            ),
            (
                "portrait-exif",
                (360, 180),
                (180, 360),
                (32, 64),
                (210, 100, 60),
                6,
            ),
        ):
            jpeg_source = tmp_path / f"{asset_id}-source.jpg"
            jpeg_target = tmp_path / f"{asset_id}-target.jpg"
            exif = Image.Exif()
            if orientation is not None:
                exif[274] = orientation
            Image.new("RGB", raw_size, color).save(jpeg_source, quality=95, exif=exif)
            jpeg_plan = _plan(
                asset_id=asset_id,
                source=jpeg_source,
                target=jpeg_target,
                before_size=display_size,
                after_size=target_size,
            )
            jpeg_intent = RenderIntent(
                plan=jpeg_plan,
                descriptor=inspect_image(jpeg_source),
                resize=resize,
                convert=ConvertOptions(format=OutputFormat.JPEG, quality=90),
            )
            jpeg_assessment = backend.assess(jpeg_intent)
            assert jpeg_assessment.route == PreprocessRoute.ACCELERATED_FULL
            jpeg_tasks.append(
                RenderTask(
                    decision=RouteDecision(
                        intent=jpeg_intent,
                        route=jpeg_assessment.route,
                        backend_id=ready.id,
                    ),
                    source=jpeg_source,
                    staging=jpeg_target,
                )
            )
            jpeg_outputs.append((jpeg_target, target_size))

        jpeg_results = backend.render_batch(jpeg_tasks)
        assert all(
            result.observation.actual_route == PreprocessRoute.ACCELERATED_FULL
            for result in jpeg_results
        )
        for jpeg_target, target_size in jpeg_outputs:
            with Image.open(jpeg_target) as image:
                image.load()
                assert image.format == "JPEG"
                assert image.size == target_size

        alpha_source = tmp_path / "source.png"
        alpha_target = tmp_path / "target.png"
        alpha_image = Image.new("RGBA", (64, 32), (255, 0, 0, 0))
        for x in range(32, 64):
            for y in range(32):
                alpha_image.putpixel((x, y), (0, 0, 255, 255))
        alpha_image.save(alpha_source)
        alpha_plan = _plan(
            asset_id="alpha",
            source=alpha_source,
            target=alpha_target,
            before_size=(64, 32),
            after_size=(128, 64),
        )
        alpha_intent = RenderIntent(
            plan=alpha_plan,
            descriptor=inspect_image(alpha_source),
            resize=resize,
            convert=None,
        )
        alpha_assessment = backend.assess(alpha_intent)
        assert alpha_assessment.route == PreprocessRoute.ACCELERATED_RESIZE
        alpha_task = RenderTask(
            decision=RouteDecision(
                intent=alpha_intent,
                route=alpha_assessment.route,
                backend_id=ready.id,
            ),
            source=alpha_source,
            staging=alpha_target,
        )
        alpha_result = backend.render_batch([alpha_task])[0]
        assert alpha_result.observation.actual_route == PreprocessRoute.ACCELERATED_RESIZE
        with Image.open(alpha_target) as image:
            image.load()
            assert image.mode == "RGBA"
            assert image.size == (128, 64)
            assert all(red == 0 for red, _green, _blue, _alpha in image.get_flattened_data())
    finally:
        backend.close()


def test_real_cuda_preparer_routes_jpeg_and_png_without_changing_workspace(
    tmp_path: Path,
) -> None:
    root = tmp_path / "dataset"
    root.mkdir()
    jpeg_source = root / "sample.jpg"
    png_source = root / "alpha.png"
    Image.new("RGB", (320, 160), (80, 140, 220)).save(jpeg_source, quality=95)
    alpha = Image.new("RGBA", (256, 128), (255, 0, 0, 0))
    for x in range(128, 256):
        for y in range(128):
            alpha.putpixel((x, y), (0, 0, 255, 255))
    alpha.save(png_source)
    items = [
        _plan(
            asset_id="jpeg",
            source=jpeg_source,
            target=jpeg_source,
            before_size=(320, 160),
            after_size=(64, 32),
        ),
        _plan(
            asset_id="png",
            source=png_source,
            target=png_source,
            before_size=(256, 128),
            after_size=(64, 32),
        ),
    ]
    items = [
        replace(
            item,
            before_hash=file_sha256(root / item.before_relative_path),
        )
        for item in items
    ]
    request = PreprocessRequest(
        resize=ResizeOptions(max_edge=64, algorithm=ResizeAlgorithm.LANCZOS3)
    )
    registry = ImageBackendRegistry()
    try:
        with PreprocessItemPreparer(
            root=root,
            operation_root=tmp_path / "operation",
            items=items,
            request=request,
            execution=PreprocessExecutionOptions(
                mode=PreprocessExecutionMode.PREFER_ACCELERATOR,
                batch_size=2,
            ),
            backend_registry=registry,
        ) as preparer:
            prepared = list(preparer)
            runtime = preparer.runtime_summary(1)
        observations = {item.plan.asset_id: item.observation for item in prepared}
        assert observations["jpeg"] is not None
        assert observations["jpeg"].actual_route == PreprocessRoute.ACCELERATED_FULL
        assert observations["png"] is not None
        assert observations["png"].actual_route == PreprocessRoute.ACCELERATED_RESIZE
        assert runtime.route_counts == {
            "accelerated_full": 1,
            "accelerated_resize": 1,
        }
        assert runtime.fallback_counts == {}
        for item in prepared:
            assert item.staging_path is not None
            with Image.open(item.staging_path) as image:
                image.load()
                assert image.size == (64, 32)
        with Image.open(jpeg_source) as image:
            assert image.size == (320, 160)
        with Image.open(png_source) as image:
            assert image.size == (256, 128)
    finally:
        registry.close()
