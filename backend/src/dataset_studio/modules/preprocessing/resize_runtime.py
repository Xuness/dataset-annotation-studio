from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image

from dataset_studio.modules.preprocessing.cuda_pipeline import (
    CudaImagePipeline,
    CudaPipelineError,
    cuda_pipeline_status,
    cuda_pipeline_supports_output,
)
from dataset_studio.modules.preprocessing.cuda_resize import (
    CudaResizeError,
    cuda_resize_status,
    resize_image_cuda,
    supports_cuda_resize,
)
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    PreprocessDevice,
    ResizeAlgorithm,
    ResizeOptions,
)

if TYPE_CHECKING:
    from dataset_studio.modules.preprocessing.planner import PlanItem

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ResizeRuntimeSelection:
    requested_device: PreprocessDevice
    resize_device: str
    cuda_available: bool
    fallback_reason: str | None
    decode_device: str = "cpu"
    encoding_device: str = "cpu"

    @property
    def pipeline_device(self) -> str:
        # A convert-only operation has no resize kernel to run. Decode and encode
        # are still fully GPU-backed, so do not label that path as mixed just
        # because the no-op resize stage is represented as CPU.
        if self.decode_device == self.encoding_device == "cuda":
            return "cuda"
        devices = {self.decode_device, self.resize_device, self.encoding_device}
        if devices == {"cuda"}:
            return "cuda"
        if "cuda" in devices:
            return "mixed"
        return "cpu"


def select_resize_runtime(
    requested_device: PreprocessDevice,
    algorithm: ResizeAlgorithm | None,
    *,
    resize_needed: bool,
) -> ResizeRuntimeSelection:
    cuda_available, cuda_reason = cuda_resize_status()
    if not resize_needed:
        return ResizeRuntimeSelection(
            requested_device=requested_device,
            resize_device="cpu",
            cuda_available=cuda_available,
            fallback_reason=None,
        )
    if requested_device == PreprocessDevice.CPU:
        return ResizeRuntimeSelection(
            requested_device=requested_device,
            resize_device="cpu",
            cuda_available=cuda_available,
            fallback_reason=None,
        )
    if algorithm is not None and not supports_cuda_resize(algorithm):
        return ResizeRuntimeSelection(
            requested_device=requested_device,
            resize_device="cpu",
            cuda_available=cuda_available,
            fallback_reason=f"{algorithm.value} 暂不支持 CUDA，已回退 CPU。",
        )
    if not cuda_available:
        return ResizeRuntimeSelection(
            requested_device=requested_device,
            resize_device="cpu",
            cuda_available=False,
            fallback_reason=cuda_reason or "CUDA 缩放运行时不可用，已回退 CPU。",
        )
    return ResizeRuntimeSelection(
        requested_device=requested_device,
        resize_device="cuda",
        cuda_available=True,
        fallback_reason=None,
    )


def select_preprocess_runtime(
    requested_device: PreprocessDevice,
    algorithm: ResizeAlgorithm | None,
    *,
    resize_needed: bool,
    encoding_supported: bool = True,
    render_needed: bool = True,
) -> ResizeRuntimeSelection:
    """Select the widest GPU path available without hiding CPU fallbacks."""
    selection = select_resize_runtime(
        requested_device,
        algorithm,
        resize_needed=resize_needed,
    )
    if requested_device == PreprocessDevice.CPU or not render_needed:
        return selection
    if not encoding_supported:
        return replace(
            selection,
            decode_device="cpu",
            encoding_device="cpu",
            fallback_reason=selection.fallback_reason
            or "目标格式不支持 CUDA 编码，已回退 CPU 编解码。",
        )
    if resize_needed and selection.resize_device != "cuda":
        return selection

    codec = cuda_pipeline_status()
    if not codec.available:
        return selection
    return replace(
        selection,
        decode_device="cuda",
        resize_device="cuda" if not resize_needed else selection.resize_device,
        encoding_device="cuda",
    )


def encoding_supports_all_rendered_outputs(
    items: list[PlanItem] | tuple[PlanItem, ...],
    convert: ConvertOptions | None,
) -> bool:
    """Check output formats once so preview and execution report the same path."""
    return all(
        cuda_pipeline_supports_output(Path(item.after_relative_path).suffix, convert)
        for item in items
    )


class ResizeExecutor:
    """Share one optional CUDA preprocessing runtime across an operation."""

    def __init__(self, selection: ResizeRuntimeSelection) -> None:
        self._requested_device = selection.requested_device
        self._resize_device = selection.resize_device
        self._decode_device = selection.decode_device
        self._encoding_device = selection.encoding_device
        self._cuda_available = selection.cuda_available
        self._fallback_reason = selection.fallback_reason
        self._state_lock = threading.Lock()
        self._pipeline: CudaImagePipeline | None = None

    @classmethod
    def create(
        cls,
        requested_device: PreprocessDevice,
        algorithm: ResizeAlgorithm | None,
        *,
        resize_needed: bool,
        encoding_supported: bool = True,
        render_needed: bool = True,
    ) -> ResizeExecutor:
        return cls(
            select_preprocess_runtime(
                requested_device,
                algorithm,
                resize_needed=resize_needed,
                encoding_supported=encoding_supported,
                render_needed=render_needed,
            )
        )

    @property
    def selection(self) -> ResizeRuntimeSelection:
        with self._state_lock:
            return ResizeRuntimeSelection(
                requested_device=self._requested_device,
                resize_device=self._resize_device,
                cuda_available=self._cuda_available,
                fallback_reason=self._fallback_reason,
                decode_device=self._decode_device,
                encoding_device=self._encoding_device,
            )

    def try_render_gpu(
        self,
        source: Path,
        staging: Path,
        item: PlanItem,
        resize: ResizeOptions | None,
        convert: ConvertOptions | None,
    ) -> bool:
        with self._state_lock:
            use_cuda_pipeline = self._decode_device == "cuda" and self._encoding_device == "cuda"
        if not use_cuda_pipeline:
            return False
        try:
            with self._state_lock:
                if self._pipeline is None:
                    self._pipeline = CudaImagePipeline()
                pipeline = self._pipeline
            pipeline.render(source, staging, item, resize, convert)
            return True
        except CudaPipelineError as error:
            reason = f"{error}；本次预处理已回退 CPU。"
            with self._state_lock:
                self._disable_full_pipeline_locked(reason)
            LOGGER.warning(reason)
            return False

    def resize(
        self,
        image: Image.Image,
        target_size: tuple[int, int],
        algorithm: ResizeAlgorithm,
        cpu_resize: Any,
    ) -> Image.Image:
        with self._state_lock:
            use_cuda = self._resize_device == "cuda"
        if not use_cuda:
            return cpu_resize(image, target_size, algorithm)
        try:
            return resize_image_cuda(image, target_size, algorithm)
        except CudaResizeError as error:
            reason = f"{error}；本次任务后续缩放已回退 CPU。"
            with self._state_lock:
                self._resize_device = "cpu"
                self._fallback_reason = reason
            LOGGER.warning(reason)
            return cpu_resize(image, target_size, algorithm)

    def _disable_full_pipeline_locked(self, reason: str) -> None:
        self._decode_device = "cpu"
        self._encoding_device = "cpu"
        self._resize_device = "cpu"
        self._fallback_reason = reason
