from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Sequence
from contextlib import nullcontext
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from PIL import Image, ImageOps

from dataset_studio.modules.taggers.adapters.base import (
    TaggerAdapter,
    TaggerRuntimeSpec,
    TaggerVocabulary,
)
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

    def get_inputs(self) -> list[Any]: ...

    def get_outputs(self) -> list[Any]: ...


class _SessionFactory(Protocol):
    def __call__(self, model_path: Path, providers: list[str]) -> _Session: ...


@dataclass(slots=True)
class _RuntimeEntry:
    installation_id: str
    directory: Path
    session: _Session
    adapter: TaggerAdapter
    vocabulary: TaggerVocabulary
    runtime_spec: TaggerRuntimeSpec
    primary_provider: str
    adaptive_batch_size: int | None
    batch_size_lock: threading.Lock
    serialize_runs: bool
    run_lock: threading.Lock
    last_used: float
    in_use: bool = False


@dataclass(slots=True)
class TaggerInferenceSession:
    """A resolved adapter/session pair reusable across an entire claimed batch."""

    profile: TaggerExecutionProfile
    entry: _RuntimeEntry

    @property
    def provider(self) -> str:
        return self.entry.primary_provider

    def effective_batch_size(self) -> int:
        batch_contract = self.entry.runtime_spec.batch
        if batch_contract.mode == "fixed":
            assert batch_contract.fixed_size is not None
            return batch_contract.fixed_size
        requested = self.profile.batch_size
        preferred = batch_contract.preferred_size(self.provider)
        batch_size = requested if requested is not None else preferred
        batch_size = min(batch_size, batch_contract.max_size)
        with self.entry.batch_size_lock:
            if self.entry.adaptive_batch_size is not None:
                batch_size = min(batch_size, self.entry.adaptive_batch_size)
        return min(32, max(1, batch_size))

    @property
    def prepared_tensor_bytes(self) -> int:
        return self.entry.runtime_spec.prepared_tensor_bytes

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
                prepared = self.entry.adapter.preprocess(self.entry.directory, image)
        except (OSError, ValueError) as error:
            raise ValueError(f"无法读取待打标图片：{error}") from error
        pixels = np.asarray(prepared)
        expected_shape = self.entry.runtime_spec.prepared_shape
        expected_dtype = self.entry.runtime_spec.prepared_dtype
        if pixels.shape != expected_shape or pixels.dtype != expected_dtype:
            raise ValueError(
                "打标器预处理结果违反 RuntimeSpec："
                f"{pixels.shape} / {pixels.dtype}，预期 {expected_shape} / {expected_dtype}"
            )
        return np.ascontiguousarray(pixels)

    def infer_batch(
        self,
        prepared: Sequence[np.ndarray],
    ) -> list[TaggerInferenceResult | Exception]:
        if not prepared:
            return []
        batch_contract = self.entry.runtime_spec.batch
        if len(prepared) > batch_contract.max_size:
            raise ValueError(f"当前模型最多支持 {batch_contract.max_size} 张图片的推理批次。")
        inference_inputs = list(prepared)
        requested_count = len(inference_inputs)
        if batch_contract.mode == "fixed":
            assert batch_contract.fixed_size is not None
            if requested_count > batch_contract.fixed_size:
                raise ValueError(
                    f"当前模型只支持固定批次 {batch_contract.fixed_size}，"
                    f"但收到了 {requested_count} 张图片。"
                )
            while len(inference_inputs) < batch_contract.fixed_size:
                inference_inputs.append(inference_inputs[-1])
        inputs = self.entry.adapter.collate(inference_inputs, self.entry.runtime_spec)
        run_guard = self.entry.run_lock if self.entry.serialize_runs else nullcontext()
        started = time.perf_counter()
        self.entry.in_use = True
        try:
            try:
                with run_guard:
                    outputs = self.entry.session.run(
                        [output.name for output in self.entry.runtime_spec.outputs],
                        inputs,
                    )
            except Exception as error:
                raise ValueError(f"ONNX 本地推理失败：{error}") from error
            elapsed_ms = (time.perf_counter() - started) * 1_000
            active_provider = self._validate_active_provider()
            results = self.entry.adapter.postprocess(
                outputs,
                self.entry.vocabulary,
                selection=self.profile.selection,
                categories=tuple(self.profile.categories),
                provider=active_provider,
                inference_ms=elapsed_ms,
            )
        finally:
            self.entry.in_use = False
        if len(results) != len(inference_inputs):
            raise ValueError(
                f"打标器返回了 {len(results)} 条结果，但推理批次包含 "
                f"{len(inference_inputs)} 张图片。"
            )
        return results[:requested_count]

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
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._taggers = taggers
        self._session_factory = session_factory or self._create_onnx_session
        self._clock = clock
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

    def prune_idle(self, timeout_seconds: float | None) -> None:
        """Release sessions that have been idle longer than the timeout.

        A session in active use is kept regardless of its idle time. A timeout
        of zero or None keeps the current behavior of never releasing.
        """
        if timeout_seconds is None or timeout_seconds <= 0:
            return
        with self._entry_lock:
            now = self._clock()
            expired = [
                (key, entry)
                for key, entry in self._entries.items()
                if not entry.in_use and now - entry.last_used > timeout_seconds
            ]
            for key, entry in expired:
                self._entries.pop(key, None)
                LOGGER.info(
                    "Releasing idle local tagger session for installation %s "
                    "(%.0fs idle, timeout %ss).",
                    entry.installation_id,
                    now - entry.last_used,
                    timeout_seconds,
                )

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
                existing.last_used = self._clock()
                self._entries[key] = existing
                return existing
            runtime_spec = adapter.runtime_spec(directory)
            model_path = (directory / runtime_spec.model_file).resolve()
            if not model_path.is_relative_to(directory) or not model_path.is_file():
                raise ValueError(f"RuntimeSpec 模型文件不存在或路径越界：{runtime_spec.model_file}")
            session, actual = self._create_session_for_device(
                profile.device,
                model_path,
                provider_candidates,
            )
            _validate_session_contract(session, runtime_spec)
            entry = _RuntimeEntry(
                installation_id=profile.installation_id,
                directory=directory,
                session=session,
                adapter=adapter,
                vocabulary=adapter.load_vocabulary(directory),
                runtime_spec=runtime_spec,
                primary_provider=actual[0],
                adaptive_batch_size=None,
                batch_size_lock=threading.Lock(),
                serialize_runs=actual[0] == "DmlExecutionProvider",
                run_lock=threading.Lock(),
                last_used=self._clock(),
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
            raise ValueError(
                f"当前 ONNX Runtime 不支持执行设备：{device.value}"
                f"（可用执行设备：{'、'.join(available)}）。"
                "请用 CUDA Runtime 启动应用（Linux：启动开发版.sh --cuda，"
                "Windows：启动开发版.bat -Runtime cuda），"
                "或将打标配置的设备改为 auto/cpu。"
            )
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


def _validate_session_contract(session: _Session, spec: TaggerRuntimeSpec) -> None:
    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1:
        raise ValueError(f"ONNX RuntimeSpec 要求单输入模型，实际输入数为 {len(inputs)}。")
    expected_outputs = {output.name: output for output in spec.outputs}
    actual_outputs = {str(output.name): output for output in outputs}
    if set(actual_outputs) != set(expected_outputs):
        raise ValueError(
            "ONNX 输出名称与 RuntimeSpec 不一致："
            f"预期 {', '.join(expected_outputs)}，实际 {', '.join(actual_outputs)}"
        )
    _validate_node_arg(inputs[0], spec.input, "输入")
    for name, expected in expected_outputs.items():
        _validate_node_arg(actual_outputs[name], expected, "输出")


def _validate_node_arg(actual: Any, expected: Any, label: str) -> None:
    if str(actual.name) != expected.name:
        raise ValueError(f"ONNX {label}名称与 RuntimeSpec 不一致：{actual.name} != {expected.name}")
    expected_type = expected.onnx_type
    if str(actual.type) != expected_type:
        raise ValueError(f"ONNX {label}类型与 RuntimeSpec 不一致：{actual.type} != {expected_type}")
    actual_shape = tuple(
        int(dimension) if isinstance(dimension, int) and not isinstance(dimension, bool) else None
        for dimension in actual.shape
    )
    if actual_shape != expected.shape:
        raise ValueError(
            f"ONNX {label}形状与 RuntimeSpec 不一致：{actual_shape} != {expected.shape}"
        )


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
