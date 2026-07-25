from __future__ import annotations

import gc
import os
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from PIL import Image

from dataset_studio.modules.preprocessing.image_pipeline import render_image_to_staging
from dataset_studio.modules.preprocessing.models import (
    OutputFormat,
    PreprocessRoute,
    ResizeAlgorithm,
)
from dataset_studio.modules.preprocessing.runtime.contracts import (
    BackendAssessment,
    BackendDescriptor,
    BackendRenderError,
    ImageRenderBackend,
    RenderIntent,
    RenderObservation,
    RenderResult,
    RenderTask,
)
from dataset_studio.modules.preprocessing.runtime.cuda_resize import (
    CudaResizeError,
    device_lock,
    load_cupy,
    resize_array_cuda,
    resize_image_cuda,
)

_CUDA_RESIZE_MODES = {"L", "LA", "RGB", "RGBA"}
_FATAL_CUDA_MARKERS = (
    "device lost",
    "cudaerrordevicelost",
    "context is destroyed",
    "initialization error",
)


def probe_cuda_descriptors() -> list[BackendDescriptor]:
    cp, reason = load_cupy()
    if cp is None:
        return [_unavailable_descriptor(reason or "CuPy CUDA Runtime 不可用。")]
    try:
        import nvidia.nvimgcodec as nvimgcodec
    except Exception as error:
        nvimgcodec = None
        codec_import_issue = f"未安装或无法加载 nvImageCodec：{error}"
    else:
        codec_import_issue = None

    try:
        device_count = int(cp.cuda.runtime.getDeviceCount())
    except Exception as error:
        return [_unavailable_descriptor(f"CUDA 设备探测失败：{error}")]
    if device_count < 1:
        return [_unavailable_descriptor("没有检测到可用的 NVIDIA CUDA 设备。")]

    descriptors: list[BackendDescriptor] = []
    for device_id in range(device_count):
        try:
            with device_lock(device_id), cp.cuda.Device(device_id):
                properties = cp.cuda.runtime.getDeviceProperties(device_id)
                raw_name = properties.get("name", f"CUDA {device_id}")
                name = (
                    raw_name.decode(errors="replace")
                    if isinstance(raw_name, bytes)
                    else str(raw_name)
                )
                resize_probe = resize_array_cuda(
                    cp.zeros((2, 2, 3), dtype=cp.uint8),
                    (1, 1),
                    ResizeAlgorithm.LANCZOS3,
                    device_id=device_id,
                )
                resize_probe.get()
                _free_bytes, total_bytes = cp.cuda.runtime.memGetInfo()
        except Exception as error:
            descriptors.append(
                BackendDescriptor(
                    id=f"cuda:{device_id}",
                    kind="cuda",
                    label=f"CUDA {device_id}",
                    status="unavailable",
                    supports_batch=True,
                    resize_algorithms=("lanczos3", "lanczos4"),
                    issue=f"CUDA 缩放后端初始化失败：{error}",
                )
            )
            continue

        codec_issue = codec_import_issue
        codec_ready = False
        if nvimgcodec is not None:
            decoder = None
            encoder = None
            try:
                with device_lock(device_id), cp.cuda.Device(device_id):
                    decoder = _create_decoder(nvimgcodec, device_id)
                    encoder = _create_encoder(nvimgcodec, device_id)
                    _probe_jpeg_codec(
                        nvimgcodec,
                        cp,
                        decoder,
                        encoder,
                    )
                codec_ready = True
            except Exception as error:
                codec_issue = f"nvImageCodec JPEG 后端初始化失败：{error}"
            finally:
                del decoder, encoder
                gc.collect()
        descriptors.append(
            BackendDescriptor(
                id=f"cuda:{device_id}",
                kind="cuda",
                label=f"CUDA {device_id} · {name}",
                status="ready" if codec_ready else "degraded",
                device_name=name,
                total_memory_bytes=int(total_bytes),
                supports_batch=True,
                decode_formats=("jpeg",) if codec_ready else (),
                encode_formats=("jpeg",) if codec_ready else (),
                resize_algorithms=("lanczos3", "lanczos4"),
                issue=(
                    None
                    if codec_ready
                    else f"{codec_issue or 'JPEG 编解码不可用'}；GPU 缩放仍可使用。"
                ),
            )
        )
    return descriptors


class CudaImageBackend(ImageRenderBackend):
    def __init__(self, descriptor: BackendDescriptor) -> None:
        if descriptor.status not in {"ready", "degraded"} or not descriptor.id.startswith("cuda:"):
            raise ValueError(f"CUDA 后端不可用：{descriptor.id}")
        self._descriptor = descriptor
        self._device_id = int(descriptor.id.split(":", 1)[1])
        cp, reason = load_cupy()
        if cp is None:
            raise RuntimeError(reason or "CuPy CUDA Runtime 不可用。")
        self._cp = cp
        self._nvimgcodec = None
        self._decoder = None
        self._encoder = None
        self._codec_issue = descriptor.issue
        if "jpeg" in descriptor.decode_formats and "jpeg" in descriptor.encode_formats:
            try:
                import nvidia.nvimgcodec as nvimgcodec

                with device_lock(self._device_id), cp.cuda.Device(self._device_id):
                    self._decoder = _create_decoder(nvimgcodec, self._device_id)
                    self._encoder = _create_encoder(nvimgcodec, self._device_id)
                self._nvimgcodec = nvimgcodec
                self._codec_issue = None
            except Exception as error:
                self._decoder = None
                self._encoder = None
                self._codec_issue = f"nvImageCodec JPEG 后端初始化失败：{error}"

    @property
    def descriptor(self) -> BackendDescriptor:
        return self._descriptor

    def assess(self, intent: RenderIntent) -> BackendAssessment:
        descriptor = intent.descriptor
        if descriptor.is_animated:
            return _unsupported("animated_image")
        if descriptor.bit_depth != 8:
            return _unsupported("unsupported_bit_depth")
        resize = intent.resize
        if intent.resize_needed and (
            resize is None
            or resize.algorithm not in {ResizeAlgorithm.LANCZOS3, ResizeAlgorithm.LANCZOS4}
        ):
            return _unsupported("unsupported_resize_algorithm")

        output_format = _output_format(intent)
        input_is_jpeg = descriptor.codec in {"jpeg", "jpg"}
        progressive_jpeg = descriptor.is_progressive and input_is_jpeg
        full_jpeg_candidate = (
            input_is_jpeg
            and output_format == OutputFormat.JPEG
            and descriptor.mode in {"L", "RGB"}
            and not descriptor.has_alpha
            and not progressive_jpeg
        )
        if full_jpeg_candidate and self._codec_available:
            return BackendAssessment(
                route=PreprocessRoute.ACCELERATED_FULL,
                supported=True,
            )
        if (
            intent.resize_needed
            and descriptor.mode in _CUDA_RESIZE_MODES
            and not (descriptor.mode in {"LA", "RGBA"} and not descriptor.has_alpha)
        ):
            return BackendAssessment(
                route=PreprocessRoute.ACCELERATED_RESIZE,
                supported=True,
            )
        if progressive_jpeg:
            return _unsupported("progressive_jpeg")
        if full_jpeg_candidate and not self._codec_available:
            return _unsupported("cuda_codec_unavailable")
        if descriptor.mode not in _CUDA_RESIZE_MODES:
            return _unsupported("unsupported_image_mode")
        if not intent.resize_needed:
            return _unsupported("no_accelerated_stage")
        return _unsupported("unsupported_codec_route")

    def render_batch(self, tasks: Sequence[RenderTask]) -> list[RenderResult]:
        if not tasks:
            return []
        routes = {task.decision.route for task in tasks}
        if len(routes) != 1:
            raise BackendRenderError(
                "mixed_batch_routes",
                "同一个 CUDA 批次不能混合不同执行路线。",
                retry_smaller_batch=True,
            )
        try:
            if PreprocessRoute.ACCELERATED_FULL in routes:
                return self._render_full_jpeg_batch(tasks)
            if PreprocessRoute.ACCELERATED_RESIZE in routes:
                return self._render_resize_batch(tasks)
            raise BackendRenderError(
                "unsupported_route",
                "CUDA 后端收到了不支持的执行路线。",
                retry_smaller_batch=False,
            )
        except BackendRenderError:
            for task in tasks:
                task.staging.unlink(missing_ok=True)
            raise
        except Exception as error:
            for task in tasks:
                task.staging.unlink(missing_ok=True)
            message = str(error)
            lowered = message.casefold()
            fatal = any(marker in lowered for marker in _FATAL_CUDA_MARKERS)
            out_of_memory = "out of memory" in lowered or "memoryerror" in lowered
            raise BackendRenderError(
                "cuda_out_of_memory" if out_of_memory else "cuda_render_failed",
                f"CUDA 图片处理失败：{error}",
                fatal=fatal,
                retry_smaller_batch=not fatal,
            ) from error

    def _render_resize_batch(self, tasks: Sequence[RenderTask]) -> list[RenderResult]:
        results: list[RenderResult] = []
        for task in tasks:
            started = time.perf_counter()

            def accelerated_resize(
                image: Image.Image,
                target_size: tuple[int, int],
                algorithm: ResizeAlgorithm,
            ) -> Image.Image:
                return resize_image_cuda(
                    image,
                    target_size,
                    algorithm,
                    device_id=self._device_id,
                )

            try:
                render_image_to_staging(
                    task.source,
                    task.staging,
                    task.decision.intent.plan,
                    task.decision.intent.resize,
                    task.decision.intent.convert,
                    resize_handler=accelerated_resize,
                )
            except CudaResizeError as error:
                raise BackendRenderError(
                    "cuda_resize_failed",
                    str(error),
                    retry_smaller_batch=False,
                ) from error
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
                        duration_ms=round((time.perf_counter() - started) * 1000),
                    ),
                )
            )
        return results

    def _render_full_jpeg_batch(self, tasks: Sequence[RenderTask]) -> list[RenderResult]:
        if not self._codec_available:
            raise BackendRenderError(
                "cuda_codec_unavailable",
                self._codec_issue or "CUDA JPEG 编解码后端不可用。",
                retry_smaller_batch=False,
            )
        started = time.perf_counter()
        temporary_paths = [_temporary_output_path(task.staging, ".jpg") for task in tasks]
        try:
            with device_lock(self._device_id), self._cp.cuda.Device(self._device_id):
                params = self._nvimgcodec.DecodeParams()
                params.apply_exif_orientation = True
                params.sample_format = self._nvimgcodec.I_RGB
                decoded = self._decoder.read(
                    [str(task.source) for task in tasks],
                    params=params,
                )
                decoded_images = list(decoded) if isinstance(decoded, (list, tuple)) else [decoded]
                if len(decoded_images) != len(tasks) or any(
                    image is None for image in decoded_images
                ):
                    raise RuntimeError("nvImageCodec 没有返回完整的 JPEG 解码批次。")

                pixels: list[Any] = []
                for task, image in zip(tasks, decoded_images, strict=True):
                    array = _as_cupy_array(self._cp, image)
                    if array.ndim != 3 or array.shape[2] != 3:
                        raise RuntimeError(f"nvImageCodec 返回了不支持的像素布局：{array.shape}")
                    if array.shape[:2] != (
                        task.decision.intent.plan.after_height,
                        task.decision.intent.plan.after_width,
                    ):
                        resize = task.decision.intent.resize
                        algorithm = resize.algorithm if resize else ResizeAlgorithm.LANCZOS3
                        array = resize_array_cuda(
                            array,
                            (
                                task.decision.intent.plan.after_width,
                                task.decision.intent.plan.after_height,
                            ),
                            algorithm,
                            device_id=self._device_id,
                        )
                    pixels.append(array)

                encode_params = _jpeg_encode_params(
                    self._nvimgcodec,
                    tasks[0].decision.intent.convert.quality
                    if tasks[0].decision.intent.convert
                    else 95,
                )
                self._encoder.write(
                    [str(path) for path in temporary_paths],
                    pixels,
                    ".jpg",
                    params=encode_params,
                )
                self._cp.cuda.Stream.null.synchronize()

            for task, temporary in zip(tasks, temporary_paths, strict=True):
                _validate_jpeg_output(
                    temporary,
                    (
                        task.decision.intent.plan.after_width,
                        task.decision.intent.plan.after_height,
                    ),
                )
            for task, temporary in zip(tasks, temporary_paths, strict=True):
                task.staging.parent.mkdir(parents=True, exist_ok=True)
                os.replace(temporary, task.staging)
        except BaseException:
            for path in temporary_paths:
                path.unlink(missing_ok=True)
            raise

        duration_ms = round((time.perf_counter() - started) * 1000)
        per_item_ms = max(0, round(duration_ms / len(tasks)))
        return [
            RenderResult(
                task=task,
                observation=RenderObservation(
                    planned_route=task.decision.route,
                    actual_route=PreprocessRoute.ACCELERATED_FULL,
                    backend_id=self._descriptor.id,
                    decode_location="hybrid",
                    resize_location=(
                        "accelerator" if task.decision.intent.resize_needed else "none"
                    ),
                    encode_location="hybrid",
                    duration_ms=per_item_ms,
                ),
            )
            for task in tasks
        ]

    def close(self) -> None:
        decoder = self._decoder
        encoder = self._encoder
        self._decoder = None
        self._encoder = None
        del decoder, encoder
        gc.collect()

    @property
    def _codec_available(self) -> bool:
        return (
            self._nvimgcodec is not None and self._decoder is not None and self._encoder is not None
        )


def _unsupported(reason_code: str) -> BackendAssessment:
    return BackendAssessment(
        route=PreprocessRoute.CPU,
        supported=False,
        reason_code=reason_code,
    )


def _output_format(intent: RenderIntent) -> OutputFormat | None:
    if intent.convert is not None:
        return intent.convert.format
    suffix = Path(intent.plan.after_relative_path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return OutputFormat.JPEG
    if suffix == ".png":
        return OutputFormat.PNG
    if suffix == ".webp":
        return OutputFormat.WEBP
    return None


def _unavailable_descriptor(issue: str) -> BackendDescriptor:
    return BackendDescriptor(
        id="cuda",
        kind="cuda",
        label="NVIDIA CUDA",
        status="unavailable",
        supports_batch=True,
        decode_formats=("jpeg",),
        encode_formats=("jpeg",),
        resize_algorithms=("lanczos3", "lanczos4"),
        issue=issue,
    )


def _codec_backends(nvimgcodec: Any) -> list[Any] | None:
    try:
        return [
            nvimgcodec.Backend(nvimgcodec.BackendKind.HW_GPU_ONLY),
            nvimgcodec.Backend(nvimgcodec.BackendKind.GPU_ONLY),
            nvimgcodec.Backend(nvimgcodec.BackendKind.HYBRID_CPU_GPU),
        ]
    except (AttributeError, TypeError):
        return None


def _create_decoder(nvimgcodec: Any, device_id: int) -> Any:
    kwargs: dict[str, Any] = {
        "device_id": device_id,
        "max_num_cpu_threads": 2,
        "options": ":num_cuda_streams=2",
    }
    backends = _codec_backends(nvimgcodec)
    if backends is not None:
        kwargs["backends"] = backends
    return nvimgcodec.Decoder(**kwargs)


def _create_encoder(nvimgcodec: Any, device_id: int) -> Any:
    kwargs: dict[str, Any] = {
        "device_id": device_id,
        "max_num_cpu_threads": 2,
        "options": ":num_cuda_streams=2",
    }
    backends = _codec_backends(nvimgcodec)
    if backends is not None:
        kwargs["backends"] = backends
    return nvimgcodec.Encoder(**kwargs)


def _as_cupy_array(cp: Any, image: Any) -> Any:
    try:
        return cp.asarray(image)
    except Exception:
        try:
            return cp.from_dlpack(image)
        except Exception:
            return cp.from_dlpack(image.to_dlpack())


def _jpeg_encode_params(nvimgcodec: Any, quality: int) -> Any:
    params = nvimgcodec.EncodeParams()
    params.quality_type = nvimgcodec.QUALITY
    params.quality_value = quality
    try:
        jpeg_params = nvimgcodec.JpegEncodeParams()
        jpeg_params.optimized_huffman = True
        params.jpeg_params = jpeg_params
    except AttributeError:
        pass
    return params


def _probe_jpeg_codec(
    nvimgcodec: Any,
    cp: Any,
    decoder: Any,
    encoder: Any,
) -> None:
    with tempfile.TemporaryDirectory(prefix="dataset-studio-jpeg-probe-") as directory:
        source = Path(directory) / "source.jpg"
        target = Path(directory) / "target.jpg"
        Image.new("RGB", (2, 2), (80, 140, 220)).save(source, quality=90)
        decode_params = nvimgcodec.DecodeParams()
        decode_params.sample_format = nvimgcodec.I_RGB
        decoded = decoder.read(str(source), params=decode_params)
        if decoded is None:
            raise RuntimeError("nvImageCodec 无法解码 JPEG 探测图片。")
        encoded = encoder.write(
            str(target),
            decoded,
            ".jpg",
            params=_jpeg_encode_params(nvimgcodec, 90),
        )
        cp.cuda.Stream.null.synchronize()
        if encoded is None:
            raise RuntimeError("nvImageCodec 无法编码 JPEG 探测图片。")
        _validate_jpeg_output(target, (2, 2))


def _temporary_output_path(staging: Path, suffix: str) -> Path:
    staging.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(
        prefix=f".{staging.stem}.cuda.",
        suffix=suffix,
        dir=staging.parent,
    )
    os.close(descriptor)
    path = Path(name)
    path.unlink()
    return path


def _validate_jpeg_output(path: Path, expected_size: tuple[int, int]) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError("CUDA JPEG 编码没有生成有效文件。")
    with Image.open(path) as image:
        image.load()
        if image.format != "JPEG":
            raise RuntimeError(f"CUDA 编码输出格式异常：{image.format}")
        if image.size != expected_size:
            raise RuntimeError(f"CUDA 编码输出尺寸异常：{image.size}，期望 {expected_size}")
