from __future__ import annotations

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

from dataset_studio.modules.taggers.models import (
    TaggerExecutionProfile,
    TaggerInferenceResult,
)

_DEFAULT_ENCODED_MEMORY_BUDGET = 256 * 1024 * 1024
_DEFAULT_PREPARED_MEMORY_BUDGET = 256 * 1024 * 1024
_DEFAULT_DECODE_PIXEL_BUDGET = 160_000_000
_MAX_DECODE_WORKERS = 4


class TaggerPipelineStopped(Exception):
    """Raised when a stop request arrives before the commit phase."""


class TaggerBoundSession(Protocol):
    @property
    def provider(self) -> str: ...

    @property
    def prepared_tensor_bytes(self) -> int: ...

    def effective_batch_size(self) -> int: ...

    def record_batch_failure(self, failed_batch_size: int) -> None: ...

    def preprocess_bytes(self, payload: bytes) -> np.ndarray: ...

    def infer_batch(
        self,
        prepared: Sequence[np.ndarray],
    ) -> list[TaggerInferenceResult | Exception]: ...


class TaggerRuntimeBinder(Protocol):
    def bind(self, profile: TaggerExecutionProfile) -> TaggerBoundSession: ...


@dataclass(frozen=True, slots=True)
class TaggerPipelineInput:
    key: str
    image_path: Path


@dataclass(frozen=True, slots=True)
class TaggerPipelineOutcome:
    key: str
    result: TaggerInferenceResult | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class TaggerPipelineReport:
    outcomes: tuple[TaggerPipelineOutcome, ...]
    requested_batch_size: int | None
    effective_batch_size: int
    provider: str


@dataclass(frozen=True, slots=True)
class _EncodedImage:
    request: TaggerPipelineInput
    payload: bytes
    source_pixels: int


@dataclass(frozen=True, slots=True)
class _PreparedImage:
    request: TaggerPipelineInput
    pixels: np.ndarray


class TaggerBatchPipeline:
    """Bounded read/decode/inference pipeline shared by local tagger adapters."""

    def __init__(
        self,
        runtime: TaggerRuntimeBinder,
        *,
        encoded_memory_budget: int = _DEFAULT_ENCODED_MEMORY_BUDGET,
        prepared_memory_budget: int = _DEFAULT_PREPARED_MEMORY_BUDGET,
        decode_pixel_budget: int = _DEFAULT_DECODE_PIXEL_BUDGET,
        max_decode_workers: int = _MAX_DECODE_WORKERS,
    ) -> None:
        if encoded_memory_budget < 1:
            raise ValueError("图片读取内存预算必须大于零。")
        if prepared_memory_budget < 1:
            raise ValueError("预处理张量内存预算必须大于零。")
        if decode_pixel_budget < 1:
            raise ValueError("图片解码像素预算必须大于零。")
        if max_decode_workers < 1:
            raise ValueError("图片解码线程数必须大于零。")
        self._runtime = runtime
        self._encoded_memory_budget = encoded_memory_budget
        self._prepared_memory_budget = prepared_memory_budget
        self._decode_pixel_budget = decode_pixel_budget
        self._max_decode_workers = max_decode_workers

    def run(
        self,
        profile: TaggerExecutionProfile,
        inputs: Sequence[TaggerPipelineInput],
        *,
        should_stop: Callable[[], bool] | None = None,
    ) -> TaggerPipelineReport:
        if not inputs:
            raise ValueError("本地打标批次不能为空。")
        stop_requested = should_stop or (lambda: False)
        self._raise_if_stopped(stop_requested)
        session = self._runtime.bind(profile)
        if session.prepared_tensor_bytes > self._prepared_memory_budget:
            raise ValueError(
                "单张图片的预处理张量已超过流水线内存上限："
                f"{session.prepared_tensor_bytes} > {self._prepared_memory_budget}"
            )
        prepared_window_limit = max(
            1,
            self._prepared_memory_budget // session.prepared_tensor_bytes,
        )
        effective_batch_size = session.effective_batch_size()
        outcomes: dict[str, TaggerPipelineOutcome] = {}
        adaptive_batch_size = effective_batch_size

        cursor = 0
        while cursor < len(inputs):
            self._raise_if_stopped(stop_requested)
            encoded, cursor = self._read_window(
                inputs,
                cursor,
                outcomes,
                stop_requested,
                prepared_window_limit,
            )
            if not encoded:
                continue
            prepared = self._preprocess_window(session, encoded, outcomes, stop_requested)
            prepared_cursor = 0
            while prepared_cursor < len(prepared):
                self._raise_if_stopped(stop_requested)
                microbatch = prepared[prepared_cursor : prepared_cursor + adaptive_batch_size]
                adaptive_batch_size = min(
                    adaptive_batch_size,
                    self._infer_with_split(
                        session,
                        microbatch,
                        outcomes,
                        stop_requested,
                    ),
                )
                prepared_cursor += len(microbatch)

        ordered = tuple(
            outcomes.get(
                item.key,
                TaggerPipelineOutcome(
                    key=item.key,
                    error="本地打标流水线没有生成结果。",
                ),
            )
            for item in inputs
        )
        return TaggerPipelineReport(
            outcomes=ordered,
            requested_batch_size=profile.batch_size,
            effective_batch_size=effective_batch_size,
            provider=session.provider,
        )

    def _read_window(
        self,
        inputs: Sequence[TaggerPipelineInput],
        cursor: int,
        outcomes: dict[str, TaggerPipelineOutcome],
        should_stop: Callable[[], bool],
        prepared_window_limit: int,
    ) -> tuple[list[_EncodedImage], int]:
        encoded: list[_EncodedImage] = []
        used_bytes = 0
        while cursor < len(inputs):
            self._raise_if_stopped(should_stop)
            request = inputs[cursor]
            try:
                payload = request.image_path.read_bytes()
                source_pixels = _image_pixel_count(payload)
            except (OSError, ValueError) as error:
                outcomes[request.key] = TaggerPipelineOutcome(
                    key=request.key,
                    error=f"无法读取待打标图片：{error}",
                )
                cursor += 1
                continue
            if encoded and used_bytes + len(payload) > self._encoded_memory_budget:
                break
            encoded.append(
                _EncodedImage(
                    request=request,
                    payload=payload,
                    source_pixels=source_pixels,
                )
            )
            used_bytes += len(payload)
            cursor += 1
            if len(encoded) >= prepared_window_limit:
                break
            if used_bytes >= self._encoded_memory_budget:
                break
        return encoded, cursor

    def _preprocess_window(
        self,
        session: TaggerBoundSession,
        encoded: Sequence[_EncodedImage],
        outcomes: dict[str, TaggerPipelineOutcome],
        should_stop: Callable[[], bool],
    ) -> list[_PreparedImage]:
        largest_image = max(item.source_pixels for item in encoded)
        pixel_limited_workers = max(1, self._decode_pixel_budget // largest_image)
        worker_count = min(
            len(encoded),
            self._max_decode_workers,
            pixel_limited_workers,
        )
        prepared: list[_PreparedImage] = []
        with ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="tagger-decode",
        ) as executor:
            futures = [executor.submit(session.preprocess_bytes, item.payload) for item in encoded]
            for item, future in zip(encoded, futures, strict=True):
                self._raise_if_stopped(should_stop)
                try:
                    pixels = future.result()
                except Exception as error:
                    outcomes[item.request.key] = TaggerPipelineOutcome(
                        key=item.request.key,
                        error=str(error) or type(error).__name__,
                    )
                    continue
                prepared.append(_PreparedImage(request=item.request, pixels=pixels))
        prepared_bytes = sum(item.pixels.nbytes for item in prepared)
        if prepared_bytes > self._prepared_memory_budget:
            raise ValueError(
                "打标器适配器返回的预处理张量超过流水线内存上限："
                f"{prepared_bytes} > {self._prepared_memory_budget}"
            )
        return prepared

    def _infer_with_split(
        self,
        session: TaggerBoundSession,
        prepared: Sequence[_PreparedImage],
        outcomes: dict[str, TaggerPipelineOutcome],
        should_stop: Callable[[], bool],
    ) -> int:
        self._raise_if_stopped(should_stop)
        try:
            results = session.infer_batch([item.pixels for item in prepared])
        except Exception as error:
            if len(prepared) == 1:
                item = prepared[0]
                outcomes[item.request.key] = TaggerPipelineOutcome(
                    key=item.request.key,
                    error=str(error) or type(error).__name__,
                )
                return 1
            session.record_batch_failure(len(prepared))
            midpoint = len(prepared) // 2
            left_size = self._infer_with_split(
                session,
                prepared[:midpoint],
                outcomes,
                should_stop,
            )
            right_size = self._infer_with_split(
                session,
                prepared[midpoint:],
                outcomes,
                should_stop,
            )
            return max(1, min(left_size, right_size, midpoint))

        for item, result in zip(prepared, results, strict=True):
            if isinstance(result, Exception):
                outcomes[item.request.key] = TaggerPipelineOutcome(
                    key=item.request.key,
                    error=str(result) or type(result).__name__,
                )
            else:
                outcomes[item.request.key] = TaggerPipelineOutcome(
                    key=item.request.key,
                    result=result,
                )
        return len(prepared)

    @staticmethod
    def _raise_if_stopped(should_stop: Callable[[], bool]) -> None:
        if should_stop():
            raise TaggerPipelineStopped("任务已由用户停止。")


def _image_pixel_count(payload: bytes) -> int:
    try:
        with Image.open(BytesIO(payload)) as image:
            width, height = image.size
    except (OSError, ValueError) as error:
        raise ValueError(str(error) or "图片格式无效。") from error
    if width < 1 or height < 1:
        raise ValueError("图片尺寸无效。")
    return width * height
