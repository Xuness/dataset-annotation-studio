from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from PIL import Image, ImageOps

from dataset_studio.modules.taggers.adapters.base import TaggerAdapter, TaggerVocabulary
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerExecutionProfile,
    TaggerInferenceResult,
)
from dataset_studio.modules.taggers.service import TaggerService

LOGGER = logging.getLogger("dataset_studio.tagger_runtime")

_DEVICE_PROVIDERS = {
    TaggerDevice.CPU: "CPUExecutionProvider",
    TaggerDevice.CUDA: "CUDAExecutionProvider",
    TaggerDevice.DIRECTML: "DmlExecutionProvider",
}
_CUDA_RUNTIME_LOCK = threading.Lock()
_CUDA_RUNTIME_PREPARED = False
_CUDA_DLL_DIRECTORY_HANDLES: list[object] = []
_CUDA_PRELOADED_DLLS: list[Any] = []


class _Session(Protocol):
    def run(self, output_names, input_feed): ...

    def get_providers(self) -> list[str]: ...


class _SessionFactory(Protocol):
    def __call__(self, model_path: Path, providers: list[str]) -> _Session: ...


@dataclass(slots=True)
class _RuntimeEntry:
    installation_id: str
    session: _Session
    adapter: TaggerAdapter
    vocabulary: TaggerVocabulary
    primary_provider: str
    batch_size_limit: int | None
    adaptive_batch_size: int | None
    batch_size_lock: threading.Lock
    serialize_runs: bool
    run_lock: threading.Lock


@dataclass(slots=True)
class TaggerInferenceSession:
    """A resolved adapter/session pair reusable across an entire claimed batch."""

    profile: TaggerExecutionProfile
    entry: _RuntimeEntry

    @property
    def provider(self) -> str:
        return self.entry.primary_provider

    def effective_batch_size(self) -> int:
        requested = self.profile.batch_size
        preferred = self.entry.adapter.preferred_batch_size(self.provider)
        batch_size = requested if requested is not None else preferred
        if self.entry.batch_size_limit is not None:
            batch_size = min(batch_size, self.entry.batch_size_limit)
        with self.entry.batch_size_lock:
            if self.entry.adaptive_batch_size is not None:
                batch_size = min(batch_size, self.entry.adaptive_batch_size)
        return min(32, max(1, batch_size))

    def record_batch_failure(self, failed_batch_size: int) -> None:
        if failed_batch_size <= 1:
            return
        reduced = max(1, failed_batch_size // 2)
        with self.entry.batch_size_lock:
            current = self.entry.adaptive_batch_size
            self.entry.adaptive_batch_size = reduced if current is None else min(current, reduced)

    def preprocess_bytes(self, payload: bytes) -> np.ndarray:
        try:
            with Image.open(BytesIO(payload)) as source:
                image = ImageOps.exif_transpose(source)
                prepared = self.entry.adapter.preprocess(image)
        except (OSError, ValueError) as error:
            raise ValueError(f"无法读取待打标图片：{error}") from error
        return np.asarray(prepared, dtype=np.float32)

    def infer_batch(
        self,
        prepared: Sequence[np.ndarray],
    ) -> list[TaggerInferenceResult | Exception]:
        if not prepared:
            return []
        if self.entry.batch_size_limit is not None and len(prepared) > self.entry.batch_size_limit:
            raise ValueError(f"当前模型最多支持 {self.entry.batch_size_limit} 张图片的推理批次。")
        inputs = self.entry.adapter.collate(prepared)
        run_guard = self.entry.run_lock if self.entry.serialize_runs else nullcontext()
        started = time.perf_counter()
        try:
            with run_guard:
                outputs = self.entry.session.run(
                    list(self.entry.adapter.output_names()),
                    inputs,
                )
        except Exception as error:
            raise ValueError(f"ONNX 本地推理失败：{error}") from error
        elapsed_ms = (time.perf_counter() - started) * 1_000
        active_provider = self._validate_active_provider()
        results = self.entry.adapter.postprocess(
            outputs,
            self.entry.vocabulary,
            threshold=self.profile.threshold,
            categories=tuple(self.profile.categories),
            provider=active_provider,
            inference_ms=elapsed_ms,
        )
        if len(results) != len(prepared):
            raise ValueError(
                f"打标器返回了 {len(results)} 条结果，但当前批次包含 {len(prepared)} 张图片。"
            )
        return results

    def _validate_active_provider(self) -> str:
        active_providers = self.entry.session.get_providers()
        if not active_providers:
            raise ValueError("ONNX 本地推理完成后没有活动的执行提供程序。")
        active_provider = active_providers[0]
        if self.profile.device != TaggerDevice.AUTO:
            expected_provider = _DEVICE_PROVIDERS[self.profile.device]
            if active_provider != expected_provider:
                raise ValueError(
                    f"请求的执行设备 {expected_provider} 在推理期间失效，"
                    f"实际为：{', '.join(active_providers)}"
                )
        elif active_provider != self.entry.primary_provider:
            previous_provider = self.entry.primary_provider
            self.entry.primary_provider = active_provider
            LOGGER.warning(
                "Local tagger provider changed during inference from %s to %s",
                previous_provider,
                active_provider,
            )
        return active_provider


class TaggerRuntime:
    """Lazily owns one heavyweight ONNX session in the worker process."""

    def __init__(
        self,
        taggers: TaggerService,
        session_factory: _SessionFactory | None = None,
    ) -> None:
        self._taggers = taggers
        self._session_factory = session_factory or self._create_onnx_session
        self._entries: OrderedDict[tuple[str, str, str], _RuntimeEntry] = OrderedDict()
        self._entry_lock = threading.Lock()

    def tag(self, profile: TaggerExecutionProfile, image_path: Path) -> TaggerInferenceResult:
        if not image_path.is_file():
            raise ValueError("图片已不存在，无法执行本地打标。")
        session = self.bind(profile)
        try:
            payload = image_path.read_bytes()
        except OSError as error:
            raise ValueError(f"无法读取待打标图片：{error}") from error
        prepared = session.preprocess_bytes(payload)
        result = session.infer_batch((prepared,))[0]
        if isinstance(result, Exception):
            raise result
        return result

    def bind(self, profile: TaggerExecutionProfile) -> TaggerInferenceSession:
        directory, adapter = self._taggers.resolve_snapshot(profile)
        provider_candidates = self._provider_candidates_for_device(profile.device)
        entry = self._entry(profile, directory, adapter, provider_candidates)
        return TaggerInferenceSession(profile=profile, entry=entry)

    def close(self) -> None:
        with self._entry_lock:
            self._entries.clear()

    def evict(self, installation_id: str) -> None:
        with self._entry_lock:
            expired = [
                key
                for key, entry in self._entries.items()
                if entry.installation_id == installation_id
            ]
            for key in expired:
                self._entries.pop(key, None)

    def prune_missing_installations(self) -> None:
        # API and Worker use separate containers in development and separate
        # runtimes in the packaged service. Polling the shared catalog releases
        # a worker-owned session shortly after its installation is deleted.
        with self._entry_lock:
            installation_ids = {entry.installation_id for entry in self._entries.values()}
        for installation_id in installation_ids:
            if not self._taggers.has_installation(installation_id):
                self.evict(installation_id)

    def _entry(
        self,
        profile: TaggerExecutionProfile,
        directory: Path,
        adapter: TaggerAdapter,
        provider_candidates: list[list[str]],
    ) -> _RuntimeEntry:
        key = (profile.installation_id, profile.fingerprint, profile.device.value)
        with self._entry_lock:
            existing = self._entries.pop(key, None)
            if existing is not None:
                self._entries[key] = existing
                return existing
            session, actual = self._create_session_for_device(
                profile.device,
                directory / "model.onnx",
                provider_candidates,
            )
            entry = _RuntimeEntry(
                installation_id=profile.installation_id,
                session=session,
                adapter=adapter,
                vocabulary=adapter.load_vocabulary(directory),
                primary_provider=actual[0],
                batch_size_limit=adapter.batch_size_limit(directory),
                adaptive_batch_size=None,
                batch_size_lock=threading.Lock(),
                serialize_runs=actual[0] == "DmlExecutionProvider",
                run_lock=threading.Lock(),
            )
            self._entries[key] = entry
            while len(self._entries) > 1:
                self._entries.popitem(last=False)
            return entry

    def _create_session_for_device(
        self,
        device: TaggerDevice,
        model_path: Path,
        provider_candidates: list[list[str]],
    ) -> tuple[_Session, list[str]]:
        failures: list[str] = []
        for providers in provider_candidates:
            requested = providers[0]
            try:
                session = self._session_factory(model_path, providers)
                actual = session.get_providers()
                if not actual or actual[0] != requested:
                    raise ValueError(
                        f"请求的执行设备 {requested} 未能启用，实际为：{', '.join(actual) or '无'}"
                    )
                return session, actual
            except Exception as error:
                if device != TaggerDevice.AUTO:
                    if isinstance(error, ValueError):
                        raise
                    raise ValueError(f"无法加载 ONNX 本地打标器：{error}") from error
                failures.append(f"{requested}: {error}")
                LOGGER.warning(
                    "Local tagger provider %s could not initialize; trying the next provider: %s",
                    requested,
                    error,
                )
        detail = "；".join(failures) or "没有候选执行设备。"
        raise ValueError(f"ONNX Runtime 自动设备选择失败：{detail}")

    @staticmethod
    def _provider_candidates_for_device(device: TaggerDevice) -> list[list[str]]:
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as error:
            raise ValueError(f"ONNX Runtime 不可用：{error}") from error
        available = list(ort.get_available_providers())
        if device == TaggerDevice.AUTO:
            candidates = [
                TaggerRuntime._provider_chain(provider, available)
                for provider in (
                    "CUDAExecutionProvider",
                    "DmlExecutionProvider",
                    "CPUExecutionProvider",
                )
                if provider in available
            ]
            if not candidates:
                raise ValueError("ONNX Runtime 没有可用的本地执行提供程序。")
            return candidates
        provider = _DEVICE_PROVIDERS[device]
        if provider not in available:
            raise ValueError(f"当前 ONNX Runtime 不支持执行设备：{device.value}")
        return [TaggerRuntime._provider_chain(provider, available)]

    @staticmethod
    def _provider_chain(provider: str, available: list[str]) -> list[str]:
        providers = [provider]
        if provider != "CPUExecutionProvider" and "CPUExecutionProvider" in available:
            providers.append("CPUExecutionProvider")
        return providers

    @staticmethod
    def _create_onnx_session(model_path: Path, providers: list[str]) -> _Session:
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as error:
            raise ValueError(f"ONNX Runtime 不可用：{error}") from error
        options = ort.SessionOptions()
        options.log_severity_level = 3
        if providers[0] == "CUDAExecutionProvider":
            _prepare_cuda_runtime(ort)
        if providers[0] == "DmlExecutionProvider":
            options.enable_mem_pattern = False
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        try:
            return ort.InferenceSession(
                str(model_path),
                sess_options=options,
                providers=providers,
            )
        except Exception as error:
            raise ValueError(f"无法加载 ONNX 本地打标器：{error}") from error


def _prepare_cuda_runtime(ort: Any) -> None:
    """Make wheel-provided CUDA DLLs discoverable before the first session."""

    global _CUDA_RUNTIME_PREPARED
    if _CUDA_RUNTIME_PREPARED:
        return
    with _CUDA_RUNTIME_LOCK:
        if _CUDA_RUNTIME_PREPARED:
            return
        dll_directories: list[Path] = []
        if os.name == "nt":
            dll_directories = _nvidia_dll_directories(ort)
            add_dll_directory = getattr(os, "add_dll_directory", None)
            if callable(add_dll_directory):
                for directory in dll_directories:
                    try:
                        _CUDA_DLL_DIRECTORY_HANDLES.append(add_dll_directory(str(directory)))
                    except OSError as error:
                        LOGGER.warning(
                            "Could not register CUDA DLL directory %s: %s", directory, error
                        )
        preload_dlls = getattr(ort, "preload_dlls", None)
        if callable(preload_dlls):
            try:
                preload_dlls()
            except Exception as error:
                LOGGER.warning("Could not preload CUDA runtime libraries: %s", error)
        if os.name == "nt":
            _preload_cudnn_sublibraries(dll_directories)
        _CUDA_RUNTIME_PREPARED = True


def _nvidia_dll_directories(ort: Any) -> list[Path]:
    package_file = getattr(ort, "__file__", None)
    if not package_file:
        return []
    nvidia_root = Path(package_file).resolve().parent.parent / "nvidia"
    if not nvidia_root.is_dir():
        return []
    return sorted(
        (directory for directory in nvidia_root.glob("*/bin") if directory.is_dir()),
        key=lambda directory: directory.as_posix().casefold(),
    )


def _preload_cudnn_sublibraries(dll_directories: list[Path]) -> None:
    # cuDNN can delay-load sublibraries that older ORT preload lists do not
    # include yet. Holding every wheel-provided cuDNN handle keeps those
    # dependencies discoverable for the lifetime of the worker process.
    import ctypes

    for directory in dll_directories:
        if directory.parent.name.casefold() != "cudnn":
            continue
        for dll_path in sorted(directory.glob("cudnn*.dll")):
            try:
                _CUDA_PRELOADED_DLLS.append(ctypes.CDLL(str(dll_path)))
            except OSError as error:
                LOGGER.warning("Could not preload cuDNN sublibrary %s: %s", dll_path, error)
