from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict

from dataset_studio.modules.preprocessing.runtime.contracts import (
    BackendDescriptor,
    ImageRenderBackend,
)
from dataset_studio.modules.preprocessing.runtime.cuda_backend import (
    CudaImageBackend,
    probe_cuda_descriptors,
)


class ImageBackendRegistry:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._descriptors: tuple[BackendDescriptor, ...] | None = None
        self._instances: dict[str, ImageRenderBackend] = {}

    def descriptors(self, *, refresh: bool = False) -> tuple[BackendDescriptor, ...]:
        with self._lock:
            if self._descriptors is None or refresh:
                if refresh:
                    self._close_locked()
                cpu = BackendDescriptor(
                    id="cpu",
                    kind="cpu",
                    label="CPU · Pillow / OpenCV",
                    status="ready",
                    supports_batch=True,
                    decode_formats=("jpeg", "png", "webp", "bmp", "tiff"),
                    encode_formats=("jpeg", "png", "webp", "bmp", "tiff"),
                    resize_algorithms=("lanczos3", "lanczos4", "anime_low_halo"),
                )
                self._descriptors = (cpu, *probe_cuda_descriptors())
            return self._descriptors

    def revision(self) -> str:
        payload = json.dumps(
            [asdict(descriptor) for descriptor in self.descriptors()],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def ready_accelerators(self) -> tuple[BackendDescriptor, ...]:
        return tuple(
            descriptor
            for descriptor in self.descriptors()
            if descriptor.id != "cpu" and descriptor.status in {"ready", "degraded"}
        )

    def descriptor(self, backend_id: str) -> BackendDescriptor | None:
        return next(
            (descriptor for descriptor in self.descriptors() if descriptor.id == backend_id),
            None,
        )

    def get(self, backend_id: str) -> ImageRenderBackend:
        if backend_id == "cpu":
            raise ValueError("CPU 后端由预处理执行器绑定当前参考实现。")
        with self._lock:
            existing = self._instances.get(backend_id)
            if existing is not None:
                return existing
            descriptor = self.descriptor(backend_id)
            if descriptor is None or descriptor.status not in {"ready", "degraded"}:
                raise ValueError(f"图片处理后端当前不可用：{backend_id}")
            if descriptor.kind != "cuda":
                raise ValueError(f"尚未实现图片处理后端：{descriptor.kind}")
            backend = CudaImageBackend(descriptor)
            self._instances[backend_id] = backend
            return backend

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        for backend in self._instances.values():
            backend.close()
        self._instances.clear()
