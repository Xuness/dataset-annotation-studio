from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
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
    center_crop,
    normalize_nchw,
    pad_to_minimum_size,
    resize_shorter_side,
)
from dataset_studio.modules.taggers.adapters.common.multilabel import build_multilabel_results
from dataset_studio.modules.taggers.models import (
    TaggerInferenceResult,
    TaggerProfileCapabilities,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan, TaggerRemoteFile

_REQUIRED_FILES = (
    "model.onnx",
    "selected_tags.csv",
    "config.json",
    "meta.json",
    "preprocess.json",
    "categories.json",
    "thresholds.csv",
)
_CATEGORY_NAMES = {0: "general", 4: "character", 9: "rating"}


@dataclass(frozen=True, slots=True)
class _AnimeTimmPreprocess:
    pad_width: int
    pad_height: int
    resize_size: int
    crop_size: int
    mean: tuple[float, float, float]
    std: tuple[float, float, float]


class AnimeTimmAdapter:
    id = "anime_timm_dbv4"
    name = "AnimeTimm DBv4"
    description = "AnimeTimm dbv4-full ONNX 模型族，支持逐标签推荐阈值。"
    contract_version = 1
    discovery_markers = ("meta.json",)

    def detect(self, directory: Path) -> bool:
        if not all((directory / name).is_file() for name in _REQUIRED_FILES):
            return False
        try:
            metadata = read_json_object(directory / "meta.json", "AnimeTimm 元数据")
        except ValueError:
            return False
        model_name = metadata.get("model_name")
        return isinstance(model_name, str) and model_name.startswith("hf-hub:animetimm/")

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        managed_files = validate_managed_files(directory, _REQUIRED_FILES)
        metadata = read_json_object(directory / "meta.json", "AnimeTimm 元数据")
        model_name = metadata.get("model_name")
        if not isinstance(model_name, str) or not model_name.startswith("hf-hub:animetimm/"):
            raise ValueError("AnimeTimm meta.json 的模型来源不受支持。")
        config = read_json_object(directory / "config.json", "AnimeTimm 配置")
        pretrained = config.get("pretrained_cfg")
        if not isinstance(pretrained, dict) or pretrained.get("tag") != "dbv4-full":
            raise ValueError("AnimeTimm 仅支持 pretrained_cfg.tag 为 dbv4-full 的模型。")
        input_size = _config_input_size(config)
        _config_num_features(config)
        preprocess = _load_preprocess(directory / "preprocess.json")
        if input_size != preprocess.crop_size:
            raise ValueError("AnimeTimm config.json 与 preprocess.json 的输入尺寸不一致。")
        category_names = _load_category_names(directory / "categories.json")
        if category_names != _CATEGORY_NAMES:
            raise ValueError("AnimeTimm DBv4 分类必须是 general、character 与 rating。")
        vocabulary = self.load_vocabulary(directory)
        declared_tags = config.get("num_classes")
        if not isinstance(declared_tags, int) or declared_tags != len(vocabulary.tags):
            raise ValueError("AnimeTimm config.json 的标签数量与词表不一致。")
        architecture = config.get("architecture")
        if not isinstance(architecture, str) or not architecture.strip():
            raise ValueError("AnimeTimm config.json 缺少 architecture。")
        return ValidatedTaggerModel(
            adapter_id=self.id,
            adapter_contract_version=self.contract_version,
            model_version=f"{architecture.strip()}.dbv4-full",
            tag_count=len(vocabulary.tags),
            categories=dict(Counter(vocabulary.categories)),
            profile_capabilities=self.profile_capabilities(directory),
            managed_files=managed_files,
        )

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary:
        category_names = _load_category_names(directory / "categories.json")
        rows = read_csv_rows(
            directory / "selected_tags.csv",
            required_columns=frozenset({"tag_id", "name", "category", "best_threshold"}),
            label="AnimeTimm 标签词表",
        )
        tags: list[str] = []
        categories: list[str] = []
        thresholds: list[float] = []
        for row in rows:
            name = row["name"].strip()
            try:
                category_id = int(row["category"])
                threshold = float(row["best_threshold"])
            except ValueError as error:
                raise ValueError("AnimeTimm 标签词表包含无效类别或推荐阈值。") from error
            category = category_names.get(category_id)
            if not name or category is None or not 0.01 <= threshold <= 0.99:
                raise ValueError("AnimeTimm 标签词表包含空标签、未知类别或越界阈值。")
            tags.append(name)
            categories.append(category)
            thresholds.append(threshold)
        if not tags or len(tags) != len(set(tags)):
            raise ValueError("AnimeTimm 标签词表为空或包含重复标签。")
        return TaggerVocabulary(
            tags=tuple(tags),
            categories=tuple(categories),
            recommended_thresholds=tuple(thresholds),
        )

    def preprocess(self, directory: Path, image: Image.Image) -> np.ndarray:
        spec = _load_preprocess(directory / "preprocess.json")
        padded = pad_to_minimum_size(
            image,
            spec.pad_width,
            spec.pad_height,
            background=(255, 255, 255),
        )
        resized = resize_shorter_side(
            padded,
            spec.resize_size,
            resample=Image.Resampling.BICUBIC,
        )
        prepared = center_crop(resized, spec.crop_size)
        return normalize_nchw(prepared, mean=spec.mean, std=spec.std)

    def runtime_spec(self, directory: Path) -> TaggerRuntimeSpec:
        config = read_json_object(directory / "config.json", "AnimeTimm 配置")
        size = _config_input_size(config)
        num_features = _config_num_features(config)
        tag_count = len(self.load_vocabulary(directory).tags)
        return TaggerRuntimeSpec(
            backend="onnx",
            model_file="model.onnx",
            input=TaggerTensorSpec(name="input", shape=(None, 3, None, None)),
            outputs=(
                TaggerTensorSpec(name="embedding", shape=(None, num_features)),
                TaggerTensorSpec(name="logits", shape=(None, tag_count)),
                TaggerTensorSpec(name="prediction", shape=(None, tag_count)),
            ),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=4,
                preferred_cpu=1,
                preferred_cuda=2,
            ),
            sample_shape=(3, size, size),
        )

    def profile_capabilities(self, directory: Path) -> TaggerProfileCapabilities:
        thresholds = _load_category_thresholds(directory / "thresholds.csv")
        return TaggerProfileCapabilities(
            supported_selection_modes=[
                TaggerSelectionMode.GLOBAL,
                TaggerSelectionMode.CATEGORY,
                TaggerSelectionMode.MODEL_RECOMMENDED,
            ],
            default_selection=TaggerSelectionPolicy(
                mode=TaggerSelectionMode.MODEL_RECOMMENDED,
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
                    f"AnimeTimm 预处理结果形状或类型异常：{pixels.shape} / {pixels.dtype}"
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
            raise ValueError("AnimeTimm ONNX 没有返回完整的三项输出。")
        return build_multilabel_results(
            outputs[2],
            vocabulary,
            selection=selection,
            categories=categories,
            provider=provider,
            inference_ms=inference_ms,
            exclusive_categories=frozenset({"rating"}),
        )

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]:
        return (
            TaggerDownloadPlan(
                plan_id="anime_timm_dbv4:caformer_b36_full",
                adapter_id=self.id,
                name="AnimeTimm DBv4 · CaFormer B36",
                model_version="caformer_b36.dbv4-full",
                description="AnimeTimm DBv4 完整标签版 CaFormer B36 ONNX 权重。",
                source_id="animetimm/caformer_b36.dbv4-full",
                revision="aac0699c88553d50eb673b41a81d8222936b22b2",
                source_url="https://huggingface.co/animetimm/caformer_b36.dbv4-full",
                gated=True,
                provenance="author",
                files=(
                    TaggerRemoteFile(
                        remote_path="model.onnx",
                        relative_path="model.onnx",
                        size=536_982_484,
                        sha256="3ba9566baed11d3cd3dd96e4cd87f0c93a92f1a4fd62b8c2a425e0d55f41c065",
                    ),
                    TaggerRemoteFile(
                        remote_path="selected_tags.csv",
                        relative_path="selected_tags.csv",
                        size=3_389_712,
                        sha256="d99cf8cc1293bb7c7671b425d25e5f3688f6937f191ab6957de93acfefdb0e55",
                    ),
                    TaggerRemoteFile(
                        remote_path="config.json",
                        relative_path="config.json",
                        size=267_687,
                        sha256="7d37124c2cee13d743a8843a42f623d6e626b625e4eea5876cec7fea06f9270f",
                    ),
                    TaggerRemoteFile(
                        remote_path="meta.json",
                        relative_path="meta.json",
                        size=318_663,
                        sha256="fac38b3843c8015e258d29cef4776971775854000c44a30668f7c92d74306719",
                    ),
                    TaggerRemoteFile(
                        remote_path="preprocess.json",
                        relative_path="preprocess.json",
                        size=2_125,
                        sha256="60c3baca177a4be5513c7bd167c60411393d8af0e0463d6bf2ba3cb43db1a74a",
                    ),
                    TaggerRemoteFile(
                        remote_path="categories.json",
                        relative_path="categories.json",
                        size=189,
                        sha256="9c02d594bba377da15a414c4ccca513959d3fb3e79d350032fabebd347f39916",
                    ),
                    TaggerRemoteFile(
                        remote_path="thresholds.csv",
                        relative_path="thresholds.csv",
                        size=292,
                        sha256="ce56bc9339e84e755a1facda2aee8356c602d3e9cf03a750f9538e9b37753aaa",
                    ),
                ),
            ),
        )


def _config_input_size(config: dict[str, object]) -> int:
    pretrained = config.get("pretrained_cfg")
    input_size = pretrained.get("input_size") if isinstance(pretrained, dict) else None
    if (
        not isinstance(input_size, list)
        or len(input_size) != 3
        or input_size[0] != 3
        or not isinstance(input_size[1], int)
        or input_size[1] != input_size[2]
    ):
        raise ValueError("AnimeTimm config.json 的 input_size 不受支持。")
    return int(input_size[1])


def _config_num_features(config: dict[str, object]) -> int:
    num_features = config.get("num_features")
    if isinstance(num_features, bool) or not isinstance(num_features, int) or num_features < 1:
        raise ValueError("AnimeTimm config.json 的 num_features 无效。")
    return num_features


def _load_category_names(path: Path) -> dict[int, str]:
    rows = read_json_array(path, "AnimeTimm 分类")
    categories: dict[int, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("AnimeTimm categories.json 包含无效项目。")
        category_id = row.get("category")
        name = row.get("name")
        if not isinstance(category_id, int) or not isinstance(name, str) or not name.strip():
            raise ValueError("AnimeTimm categories.json 包含无效分类。")
        categories[category_id] = name.strip().casefold()
    return categories


def _load_category_thresholds(path: Path) -> dict[str, float]:
    rows = read_csv_rows(
        path,
        required_columns=frozenset({"category", "name", "threshold"}),
        label="AnimeTimm 分类阈值",
    )
    thresholds: dict[str, float] = {}
    for row in rows:
        name = row["name"].strip().casefold()
        try:
            threshold = float(row["threshold"])
        except ValueError as error:
            raise ValueError("AnimeTimm 分类阈值包含无效数值。") from error
        if name not in _CATEGORY_NAMES.values() or not 0.01 <= threshold <= 0.99:
            raise ValueError("AnimeTimm 分类阈值包含未知类别或越界数值。")
        thresholds[name] = threshold
    if set(thresholds) != set(_CATEGORY_NAMES.values()):
        raise ValueError("AnimeTimm 分类阈值不完整。")
    return thresholds


@lru_cache(maxsize=32)
def _load_preprocess(path: Path) -> _AnimeTimmPreprocess:
    payload = read_json_object(path, "AnimeTimm 预处理配置")
    stages = payload.get("test")
    if not isinstance(stages, list) or len(stages) != 5:
        raise ValueError("AnimeTimm preprocess.json 的 test 阶段结构不兼容。")
    pad, resize, crop, tensor, normalize = stages
    if not all(isinstance(stage, dict) for stage in stages):
        raise ValueError("AnimeTimm preprocess.json 包含无效阶段。")
    assert isinstance(pad, dict)
    assert isinstance(resize, dict)
    assert isinstance(crop, dict)
    assert isinstance(tensor, dict)
    assert isinstance(normalize, dict)
    pad_size = pad.get("size")
    crop_size = crop.get("size")
    resize_size = resize.get("size")
    mean = normalize.get("mean")
    std = normalize.get("std")
    if (
        pad.get("type") != "pad_to_size"
        or pad.get("background_color") != "white"
        or not isinstance(pad_size, list)
        or len(pad_size) != 2
        or not all(isinstance(value, int) and value > 0 for value in pad_size)
        or resize.get("type") != "resize"
        or resize.get("interpolation") != "bicubic"
        or not isinstance(resize_size, int)
        or resize_size < 1
        or crop.get("type") != "center_crop"
        or not isinstance(crop_size, list)
        or len(crop_size) != 2
        or crop_size[0] != crop_size[1]
        or not isinstance(crop_size[0], int)
        or tensor.get("type") != "maybe_to_tensor"
        or normalize.get("type") != "normalize"
        or not isinstance(mean, list)
        or not isinstance(std, list)
        or len(mean) != 3
        or len(std) != 3
    ):
        raise ValueError("AnimeTimm preprocess.json 与支持的 DBv4 配置不一致。")
    return _AnimeTimmPreprocess(
        pad_width=int(pad_size[0]),
        pad_height=int(pad_size[1]),
        resize_size=resize_size,
        crop_size=int(crop_size[0]),
        mean=tuple(float(value) for value in mean),
        std=tuple(float(value) for value in std),
    )
