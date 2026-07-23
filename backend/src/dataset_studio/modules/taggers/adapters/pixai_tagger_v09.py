from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from PIL import Image

from dataset_studio.modules.taggers.adapters.base import (
    TaggerBatchContract,
    TaggerRuntimeSpec,
    TaggerTensorSpec,
    TaggerVocabulary,
    ValidatedTaggerModel,
)
from dataset_studio.modules.taggers.adapters.common.files import (
    read_csv_rows,
    read_json_array,
    read_json_object,
    validate_managed_files,
)
from dataset_studio.modules.taggers.adapters.common.image_preprocessing import (
    normalize_nchw,
    rgb_image,
)
from dataset_studio.modules.taggers.adapters.common.multilabel import build_multilabel_results
from dataset_studio.modules.taggers.models import (
    TaggerInferenceResult,
    TaggerProfileCapabilities,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan

_REQUIRED_FILES = (
    "model.onnx",
    "selected_tags.csv",
    "meta.json",
    "preprocess.json",
    "categories.json",
    "thresholds.csv",
)
_SOURCE_REPO = "pixai-labs/pixai-tagger-v0.9"
_EXPECTED_TAG_COUNT = 13_461


class PixAITaggerV09Adapter:
    id = "pixai_tagger_v09"
    name = "PixAI Tagger v0.9"
    description = "PixAI v0.9 的 DeepGHS ONNX 转换包，仅支持固定元数据结构。"
    contract_version = 1
    discovery_markers = ("meta.json",)

    def detect(self, directory: Path) -> bool:
        if not all((directory / name).is_file() for name in _REQUIRED_FILES):
            return False
        try:
            metadata = read_json_object(directory / "meta.json", "PixAI ONNX 元数据")
        except ValueError:
            return False
        return metadata.get("repo_id") == _SOURCE_REPO

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        managed_files = validate_managed_files(directory, _REQUIRED_FILES)
        metadata = read_json_object(directory / "meta.json", "PixAI ONNX 元数据")
        if metadata.get("repo_id") != _SOURCE_REPO:
            raise ValueError("PixAI ONNX meta.json 的来源仓库不受支持。")
        if metadata.get("input_size") != 448 or metadata.get("num_classes") != _EXPECTED_TAG_COUNT:
            raise ValueError("PixAI ONNX meta.json 的输入尺寸或标签数量不兼容。")
        _validate_preprocess(directory / "preprocess.json")
        category_names = _load_category_names(directory / "categories.json")
        if category_names != {0: "general", 4: "character"}:
            raise ValueError("PixAI ONNX categories.json 与 v0.9 官方分类不一致。")
        vocabulary = self.load_vocabulary(directory)
        if len(vocabulary.tags) != _EXPECTED_TAG_COUNT:
            raise ValueError(
                f"PixAI v0.9 词表包含 {len(vocabulary.tags)} 个标签，"
                f"预期 {_EXPECTED_TAG_COUNT} 个。"
            )
        categories = dict(Counter(vocabulary.categories))
        return ValidatedTaggerModel(
            adapter_id=self.id,
            adapter_contract_version=self.contract_version,
            model_version="v0.9-onnx",
            tag_count=len(vocabulary.tags),
            categories=categories,
            profile_capabilities=self.profile_capabilities(directory),
            managed_files=managed_files,
            warnings=("官方 v0.9 词表索引 8968 为空，已保留为默认禁用的 unknown 占位标签。",),
        )

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary:
        category_names = _load_category_names(directory / "categories.json")
        rows = read_csv_rows(
            directory / "selected_tags.csv",
            required_columns=frozenset({"id", "tag_id", "name", "category", "count"}),
            label="PixAI v0.9 标签词表",
        )
        tags: list[str] = []
        categories: list[str] = []
        for expected_id, row in enumerate(rows):
            try:
                row_id = int(row["id"])
                category_id = int(row["category"])
            except ValueError as error:
                raise ValueError("PixAI v0.9 标签词表包含无效索引或类别。") from error
            if row_id != expected_id:
                raise ValueError("PixAI v0.9 标签词表索引不连续。")
            name = row["name"].strip()
            category = category_names.get(category_id)
            if row_id == 8968 and row.get("tag_id") == "-1" and not name and category_id == 0:
                # The published v0.9 package deliberately preserves one empty
                # output slot. Keep its tensor alignment without exposing an
                # empty caption token in the normal general category.
                name = "__unknown_tag_8968"
                category = "unknown"
            if not name or category is None:
                raise ValueError("PixAI v0.9 标签词表包含空标签或未知类别。")
            tags.append(name)
            categories.append(category)
        if not tags or len(tags) != len(set(tags)):
            raise ValueError("PixAI v0.9 标签词表为空或包含重复标签。")
        return TaggerVocabulary(tags=tuple(tags), categories=tuple(categories))

    def preprocess(self, directory: Path, image: Image.Image) -> np.ndarray:
        del directory
        resized = rgb_image(image).resize((448, 448), Image.Resampling.BILINEAR)
        return normalize_nchw(
            resized,
            mean=(0.5, 0.5, 0.5),
            std=(0.5, 0.5, 0.5),
        )

    def runtime_spec(self, directory: Path) -> TaggerRuntimeSpec:
        tag_count = len(self.load_vocabulary(directory).tags)
        return TaggerRuntimeSpec(
            backend="onnx",
            model_file="model.onnx",
            input=TaggerTensorSpec(name="input", shape=(None, 3, 448, 448)),
            outputs=(
                TaggerTensorSpec(name="embedding", shape=(None, 1024)),
                TaggerTensorSpec(name="logits", shape=(None, tag_count)),
                TaggerTensorSpec(name="prediction", shape=(None, tag_count)),
            ),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=4,
                preferred_cpu=1,
                preferred_cuda=2,
            ),
            sample_shape=(3, 448, 448),
        )

    def profile_capabilities(self, directory: Path) -> TaggerProfileCapabilities:
        thresholds = _load_category_thresholds(directory / "thresholds.csv")
        return TaggerProfileCapabilities(
            supported_selection_modes=[
                TaggerSelectionMode.GLOBAL,
                TaggerSelectionMode.CATEGORY,
            ],
            default_selection=TaggerSelectionPolicy(
                mode=TaggerSelectionMode.CATEGORY,
                global_threshold=thresholds["general"],
                category_thresholds=thresholds,
            ),
            default_categories=["general", "character"],
        )

    def collate(
        self,
        prepared: Sequence[np.ndarray],
        runtime_spec: TaggerRuntimeSpec,
    ) -> dict[str, np.ndarray]:
        if not prepared:
            raise ValueError("本地打标批次不能为空。")
        expected = runtime_spec.prepared_shape
        for pixels in prepared:
            if pixels.shape != expected or pixels.dtype != np.float32:
                raise ValueError(
                    f"PixAI v0.9 预处理结果形状或类型异常：{pixels.shape} / {pixels.dtype}"
                )
        return {runtime_spec.input.name: np.ascontiguousarray(np.stack(prepared, axis=0))}

    def postprocess(
        self,
        outputs: Sequence[object],
        vocabulary: TaggerVocabulary,
        *,
        selection: TaggerSelectionPolicy,
        categories: tuple[str, ...],
        provider: str,
        inference_ms: float,
    ) -> list[TaggerInferenceResult | Exception]:
        if len(outputs) != 3:
            raise ValueError("PixAI v0.9 ONNX 没有返回完整的三项输出。")
        return build_multilabel_results(
            outputs[2],
            vocabulary,
            selection=selection,
            categories=categories,
            provider=provider,
            inference_ms=inference_ms,
        )

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]:
        return ()


def _load_category_names(path: Path) -> dict[int, str]:
    rows = read_json_array(path, "PixAI ONNX 分类")
    categories: dict[int, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("PixAI ONNX categories.json 包含无效项目。")
        category_id = row.get("category")
        name = row.get("name")
        if not isinstance(category_id, int) or not isinstance(name, str) or not name.strip():
            raise ValueError("PixAI ONNX categories.json 包含无效分类。")
        categories[category_id] = name.strip().casefold()
    return categories


def _load_category_thresholds(path: Path) -> dict[str, float]:
    rows = read_csv_rows(
        path,
        required_columns=frozenset({"category", "name", "threshold"}),
        label="PixAI v0.9 分类阈值",
    )
    thresholds: dict[str, float] = {}
    for row in rows:
        name = row["name"].strip().casefold()
        try:
            threshold = float(row["threshold"])
        except ValueError as error:
            raise ValueError("PixAI v0.9 分类阈值包含无效数值。") from error
        if name not in {"general", "character"} or not 0.01 <= threshold <= 0.99:
            raise ValueError("PixAI v0.9 分类阈值包含未知类别或越界数值。")
        thresholds[name] = threshold
    if set(thresholds) != {"general", "character"}:
        raise ValueError("PixAI v0.9 分类阈值不完整。")
    return thresholds


def _validate_preprocess(path: Path) -> None:
    payload = read_json_object(path, "PixAI ONNX 预处理配置")
    stages = payload.get("stages")
    if not isinstance(stages, list) or len(stages) != 3:
        raise ValueError("PixAI ONNX preprocess.json 的阶段结构不兼容。")
    resize, to_tensor, normalize = stages
    if (
        not isinstance(resize, dict)
        or resize.get("type") != "resize"
        or resize.get("size") != [448, 448]
        or resize.get("interpolation") != "bilinear"
        or not isinstance(to_tensor, dict)
        or to_tensor.get("type") != "to_tensor"
        or not isinstance(normalize, dict)
        or normalize.get("type") != "normalize"
        or normalize.get("mean") != [0.5, 0.5, 0.5]
        or normalize.get("std") != [0.5, 0.5, 0.5]
    ):
        raise ValueError("PixAI ONNX preprocess.json 与支持的 v0.9 配置不一致。")
