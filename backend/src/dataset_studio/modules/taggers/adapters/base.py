from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import numpy as np
from PIL import Image

from dataset_studio.modules.taggers.models import (
    TaggerInferenceResult,
    TaggerProfileCapabilities,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan

_ONNX_DTYPE_NAMES = {
    "bool": "bool",
    "float16": "float16",
    "float32": "float",
    "float64": "double",
    "int8": "int8",
    "int16": "int16",
    "int32": "int32",
    "int64": "int64",
    "uint8": "uint8",
    "uint16": "uint16",
    "uint32": "uint32",
    "uint64": "uint64",
}


@dataclass(frozen=True, slots=True)
class TaggerVocabulary:
    tags: tuple[str, ...]
    categories: tuple[str, ...]
    recommended_thresholds: tuple[float | None, ...] = ()

    def __post_init__(self) -> None:
        if len(self.tags) != len(self.categories):
            raise ValueError("打标器词表的标签与类别数量不一致。")
        if not self.tags or any(not tag for tag in self.tags):
            raise ValueError("打标器词表不能为空或包含空标签。")
        if len(self.tags) != len(set(self.tags)):
            raise ValueError("打标器词表包含重复标签。")
        if any(not category for category in self.categories):
            raise ValueError("打标器词表包含空类别。")
        if self.recommended_thresholds and len(self.recommended_thresholds) != len(self.tags):
            raise ValueError("打标器词表的逐标签阈值数量不一致。")
        if any(
            threshold is not None and not 0.01 <= threshold <= 0.99
            for threshold in self.recommended_thresholds
        ):
            raise ValueError("打标器词表包含越界的逐标签阈值。")


@dataclass(frozen=True, slots=True)
class TaggerTensorSpec:
    name: str
    shape: tuple[int | None, ...]
    dtype: str = "float32"

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("RuntimeSpec 的张量名称不能为空。")
        if not self.shape:
            raise ValueError("RuntimeSpec 的张量形状不能为空。")
        if any(
            dimension is not None
            and (isinstance(dimension, bool) or not isinstance(dimension, int) or dimension < 1)
            for dimension in self.shape
        ):
            raise ValueError("RuntimeSpec 的张量维度必须是正整数或动态维度。")
        try:
            dtype_name = np.dtype(self.dtype).name
        except TypeError as error:
            raise ValueError(f"RuntimeSpec 包含未知张量类型：{self.dtype}") from error
        if dtype_name not in _ONNX_DTYPE_NAMES:
            raise ValueError(f"RuntimeSpec 不支持张量类型：{self.dtype}")

    @property
    def onnx_type(self) -> str:
        return f"tensor({_ONNX_DTYPE_NAMES[np.dtype(self.dtype).name]})"


@dataclass(frozen=True, slots=True)
class TaggerBatchContract:
    mode: Literal["dynamic", "fixed"]
    max_size: int
    preferred_cpu: int
    preferred_cuda: int
    preferred_directml: int = 1
    fixed_size: int | None = None

    def __post_init__(self) -> None:
        if not 1 <= self.max_size <= 32:
            raise ValueError("打标器最大批次必须位于 1 到 32 之间。")
        if any(
            not 1 <= preferred <= self.max_size
            for preferred in (
                self.preferred_cpu,
                self.preferred_cuda,
                self.preferred_directml,
            )
        ):
            raise ValueError("打标器推荐批次必须位于 1 到最大批次之间。")
        if self.mode == "fixed" and self.fixed_size is None:
            raise ValueError("固定批次模型必须声明固定批大小。")
        if self.fixed_size is not None and self.fixed_size < 1:
            raise ValueError("固定批大小必须大于零。")
        if self.mode == "fixed" and self.fixed_size != self.max_size:
            raise ValueError("固定批次模型的最大批次必须等于固定批大小。")

    def preferred_size(self, execution_provider: str) -> int:
        if self.mode == "fixed":
            assert self.fixed_size is not None
            return self.fixed_size
        if execution_provider == "CUDAExecutionProvider":
            return self.preferred_cuda
        if execution_provider == "CPUExecutionProvider":
            return self.preferred_cpu
        return self.preferred_directml


@dataclass(frozen=True, slots=True)
class TaggerRuntimeSpec:
    backend: Literal["onnx"]
    model_file: str
    input: TaggerTensorSpec
    outputs: tuple[TaggerTensorSpec, ...]
    batch: TaggerBatchContract
    sample_shape: tuple[int, ...]

    def __post_init__(self) -> None:
        model_path = Path(self.model_file)
        if (
            self.backend != "onnx"
            or not self.model_file.strip()
            or model_path.is_absolute()
            or ".." in model_path.parts
        ):
            raise ValueError("RuntimeSpec 的 ONNX 模型路径无效。")
        if len(self.input.shape) != len(self.sample_shape) + 1:
            raise ValueError("RuntimeSpec 的输入与单图张量维度不一致。")
        if any(dimension < 1 for dimension in self.sample_shape):
            raise ValueError("RuntimeSpec 的单图张量形状必须为正整数。")
        if any(
            graph_dimension is not None and graph_dimension != sample_dimension
            for graph_dimension, sample_dimension in zip(
                self.input.shape[1:],
                self.sample_shape,
                strict=True,
            )
        ):
            raise ValueError("RuntimeSpec 的固定输入维度与单图张量形状不一致。")
        batch_dimension = self.input.shape[0]
        if self.batch.mode == "dynamic" and batch_dimension is not None:
            raise ValueError("动态批次 RuntimeSpec 不能声明固定的输入批次维度。")
        if self.batch.mode == "fixed" and batch_dimension != self.batch.fixed_size:
            raise ValueError("固定批次 RuntimeSpec 的输入批次维度不一致。")
        output_names = [output.name for output in self.outputs]
        if not output_names or len(output_names) != len(set(output_names)):
            raise ValueError("RuntimeSpec 必须声明不重复的输出名称。")
        if any(output.shape[0] != batch_dimension for output in self.outputs):
            raise ValueError("RuntimeSpec 的输入与输出批次维度不一致。")

    @property
    def prepared_shape(self) -> tuple[int, ...]:
        return self.sample_shape

    @property
    def prepared_dtype(self) -> np.dtype:
        return np.dtype(self.input.dtype)

    @property
    def prepared_tensor_bytes(self) -> int:
        return int(np.prod(self.prepared_shape, dtype=np.int64)) * self.prepared_dtype.itemsize


@dataclass(frozen=True, slots=True)
class ValidatedTaggerModel:
    adapter_id: str
    adapter_contract_version: int
    model_version: str
    tag_count: int
    categories: dict[str, int]
    profile_capabilities: TaggerProfileCapabilities
    managed_files: tuple[str, ...]
    warnings: tuple[str, ...] = ()


class TaggerAdapter(Protocol):
    id: str
    name: str
    description: str
    contract_version: int
    discovery_markers: tuple[str, ...]

    def detect(self, directory: Path) -> bool: ...

    def validate(self, directory: Path) -> ValidatedTaggerModel: ...

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary: ...

    def preprocess(self, directory: Path, image: Image.Image) -> np.ndarray: ...

    def runtime_spec(self, directory: Path) -> TaggerRuntimeSpec: ...

    def profile_capabilities(self, directory: Path) -> TaggerProfileCapabilities: ...

    def collate(
        self,
        prepared: Sequence[np.ndarray],
        runtime_spec: TaggerRuntimeSpec,
    ) -> dict[str, np.ndarray]: ...

    def postprocess(
        self,
        outputs: Sequence[object],
        vocabulary: TaggerVocabulary,
        *,
        selection: TaggerSelectionPolicy,
        categories: tuple[str, ...],
        provider: str,
        inference_ms: float,
    ) -> list[TaggerInferenceResult | Exception]: ...

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]: ...
