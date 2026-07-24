from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from PIL import Image

from dataset_studio.modules.preprocessing.cuda_resize import (
    CudaResizeError,
    cuda_resize_status,
    resize_image_cuda,
    supports_cuda_resize,
)
from dataset_studio.modules.preprocessing.models import PreprocessDevice, ResizeAlgorithm

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ResizeRuntimeSelection:
    requested_device: PreprocessDevice
    resize_device: str
    cuda_available: bool
    fallback_reason: str | None

    @property
    def pipeline_device(self) -> str:
        return "mixed" if self.resize_device == "cuda" else "cpu"


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


class ResizeExecutor:
    """Share one optional CUDA resize runtime across a preprocessing operation."""

    def __init__(self, selection: ResizeRuntimeSelection) -> None:
        self._requested_device = selection.requested_device
        self._resize_device = selection.resize_device
        self._cuda_available = selection.cuda_available
        self._fallback_reason = selection.fallback_reason
        self._state_lock = threading.Lock()

    @classmethod
    def create(
        cls,
        requested_device: PreprocessDevice,
        algorithm: ResizeAlgorithm | None,
        *,
        resize_needed: bool,
    ) -> ResizeExecutor:
        return cls(
            select_resize_runtime(
                requested_device,
                algorithm,
                resize_needed=resize_needed,
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
            )

    def resize(
        self,
        image: Image.Image,
        target_size: tuple[int, int],
        algorithm: ResizeAlgorithm,
        cpu_resize,
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
