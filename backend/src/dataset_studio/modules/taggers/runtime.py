from __future__ import annotations

import threading
import time
from collections import OrderedDict
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

from dataset_studio.modules.taggers.adapters.base import TaggerAdapter, TaggerVocabulary
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerExecutionProfile,
    TaggerInferenceResult,
    TaggerInferenceTag,
)
from dataset_studio.modules.taggers.service import TaggerService


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
    serialize_runs: bool
    run_lock: threading.Lock


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
        directory, adapter = self._taggers.resolve_snapshot(profile)
        providers = self._providers_for_device(profile.device)
        entry = self._entry(profile, directory, adapter, providers)
        started = time.perf_counter()
        try:
            with Image.open(image_path) as image:
                pixels = adapter.preprocess(image)
        except (OSError, ValueError) as error:
            raise ValueError(f"无法读取待打标图片：{error}") from error

        run_guard = entry.run_lock if entry.serialize_runs else nullcontext()
        try:
            with run_guard:
                outputs = entry.session.run(["logits"], {"pixel_values": pixels})
        except Exception as error:
            raise ValueError(f"ONNX 本地推理失败：{error}") from error
        if not outputs:
            raise ValueError("ONNX 本地推理没有返回 logits。")
        logits = np.asarray(outputs[0], dtype=np.float32)
        if logits.ndim != 2 or logits.shape[0] != 1:
            raise ValueError(f"ONNX logits 形状异常：{tuple(logits.shape)}")
        values = logits[0]
        if values.shape[0] != len(entry.vocabulary.tags):
            raise ValueError("ONNX 输出标签数与模型词表不一致。")
        probabilities = 1.0 / (1.0 + np.exp(-np.clip(values, -80.0, 80.0)))
        enabled_categories = set(profile.categories)
        selected = [
            TaggerInferenceTag(
                name=tag,
                category=category,
                confidence=float(probabilities[index]),
            )
            for index, (tag, category) in enumerate(
                zip(entry.vocabulary.tags, entry.vocabulary.categories, strict=True)
            )
            if category in enabled_categories and probabilities[index] >= profile.threshold
        ]
        selected.sort(key=lambda item: (-item.confidence, item.name.casefold()))
        if not selected:
            raise ValueError("当前阈值与类别设置没有产生任何标签，请调整打标配置后重试。")
        elapsed_ms = (time.perf_counter() - started) * 1_000
        active_providers = entry.session.get_providers()
        return TaggerInferenceResult(
            content=", ".join(item.name for item in selected),
            tags=selected,
            provider=active_providers[0] if active_providers else providers[0],
            inference_ms=elapsed_ms,
        )

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
        providers: list[str],
    ) -> _RuntimeEntry:
        key = (profile.installation_id, profile.fingerprint, profile.device.value)
        with self._entry_lock:
            existing = self._entries.pop(key, None)
            if existing is not None:
                self._entries[key] = existing
                return existing
            session = self._session_factory(directory / "model.onnx", providers)
            actual = session.get_providers()
            if not actual or actual[0] != providers[0]:
                raise ValueError(
                    f"请求的执行设备 {providers[0]} 未能启用，实际为：{', '.join(actual) or '无'}"
                )
            entry = _RuntimeEntry(
                installation_id=profile.installation_id,
                session=session,
                adapter=adapter,
                vocabulary=adapter.load_vocabulary(directory),
                serialize_runs=providers[0] == "DmlExecutionProvider",
                run_lock=threading.Lock(),
            )
            self._entries[key] = entry
            while len(self._entries) > 1:
                self._entries.popitem(last=False)
            return entry

    @staticmethod
    def _providers_for_device(device: TaggerDevice) -> list[str]:
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as error:
            raise ValueError(f"ONNX Runtime 不可用：{error}") from error
        available = list(ort.get_available_providers())
        requested = {
            TaggerDevice.CPU: "CPUExecutionProvider",
            TaggerDevice.CUDA: "CUDAExecutionProvider",
            TaggerDevice.DIRECTML: "DmlExecutionProvider",
        }
        if device == TaggerDevice.AUTO:
            preferred = [
                provider
                for provider in (
                    "CUDAExecutionProvider",
                    "DmlExecutionProvider",
                    "CPUExecutionProvider",
                )
                if provider in available
            ]
            if not preferred:
                raise ValueError("ONNX Runtime 没有可用的本地执行提供程序。")
            return preferred
        provider = requested[device]
        if provider not in available:
            raise ValueError(f"当前 ONNX Runtime 不支持执行设备：{device.value}")
        fallbacks = ["CPUExecutionProvider"] if provider != "CPUExecutionProvider" else []
        return [provider, *[item for item in fallbacks if item in available]]

    @staticmethod
    def _create_onnx_session(model_path: Path, providers: list[str]) -> _Session:
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as error:
            raise ValueError(f"ONNX Runtime 不可用：{error}") from error
        options = ort.SessionOptions()
        options.log_severity_level = 3
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
