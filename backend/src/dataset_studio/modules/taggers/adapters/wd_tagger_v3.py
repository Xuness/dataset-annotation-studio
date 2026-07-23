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
    read_json_object,
    validate_managed_files,
)
from dataset_studio.modules.taggers.adapters.common.image_preprocessing import square_pad
from dataset_studio.modules.taggers.adapters.common.multilabel import build_multilabel_results
from dataset_studio.modules.taggers.models import (
    TaggerInferenceResult,
    TaggerProfileCapabilities,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan, TaggerRemoteFile

_REQUIRED_FILES = ("model.onnx", "selected_tags.csv", "config.json")
_CATEGORY_NAMES = {0: "general", 4: "character", 9: "rating"}
_EXPECTED_TAG_COUNT = 10_861


class WDTaggerV3Adapter:
    id = "wd_tagger_v3"
    name = "WD Tagger v3"
    description = "SmilingWolf 官方 WD v3 ONNX 多标签打标器。"
    contract_version = 1
    discovery_markers = ("selected_tags.csv",)

    def detect(self, directory: Path) -> bool:
        if not all((directory / name).is_file() for name in _REQUIRED_FILES):
            return False
        try:
            config = read_json_object(directory / "config.json", "WD v3 配置")
        except ValueError:
            return False
        return (
            config.get("num_classes") == _EXPECTED_TAG_COUNT
            and _config_image_size(config) == 448
            and not (directory / "meta.json").exists()
        )

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        managed_files = validate_managed_files(directory, _REQUIRED_FILES)
        config = read_json_object(directory / "config.json", "WD v3 配置")
        if config.get("num_classes") != _EXPECTED_TAG_COUNT:
            raise ValueError("WD v3 config.json 的标签数量不是 10861。")
        if _config_image_size(config) != 448:
            raise ValueError("WD v3 config.json 的输入尺寸不是 448。")
        architecture = config.get("architecture")
        if not isinstance(architecture, str) or not architecture.strip():
            raise ValueError("WD v3 config.json 缺少 architecture。")
        vocabulary = self.load_vocabulary(directory)
        if len(vocabulary.tags) != _EXPECTED_TAG_COUNT:
            raise ValueError(
                f"WD v3 词表包含 {len(vocabulary.tags)} 个标签，预期 {_EXPECTED_TAG_COUNT} 个。"
            )
        categories = dict(Counter(vocabulary.categories))
        if not {"general", "character", "rating"}.issubset(categories):
            raise ValueError("WD v3 词表缺少 general、character 或 rating 类别。")
        return ValidatedTaggerModel(
            adapter_id=self.id,
            adapter_contract_version=self.contract_version,
            model_version=f"v3-{architecture.strip()}",
            tag_count=len(vocabulary.tags),
            categories=categories,
            profile_capabilities=self.profile_capabilities(directory),
            managed_files=managed_files,
        )

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary:
        rows = read_csv_rows(
            directory / "selected_tags.csv",
            required_columns=frozenset({"tag_id", "name", "category", "count"}),
            label="WD v3 标签词表",
        )
        tags: list[str] = []
        categories: list[str] = []
        for row in rows:
            name = row["name"].strip()
            if not name:
                raise ValueError("WD v3 标签词表包含空标签。")
            try:
                category_id = int(row["category"])
            except ValueError as error:
                raise ValueError("WD v3 标签词表包含无效类别。") from error
            category = _CATEGORY_NAMES.get(category_id)
            if category is None:
                raise ValueError(f"WD v3 标签词表包含未知类别：{category_id}")
            tags.append(name)
            categories.append(category)
        if not tags or len(tags) != len(set(tags)):
            raise ValueError("WD v3 标签词表为空或包含重复标签。")
        return TaggerVocabulary(tags=tuple(tags), categories=tuple(categories))

    def preprocess(self, directory: Path, image: Image.Image) -> np.ndarray:
        del directory
        prepared = square_pad(image).resize((448, 448), Image.Resampling.BICUBIC)
        rgb = np.asarray(prepared, dtype=np.float32)
        return np.ascontiguousarray(rgb[:, :, ::-1])

    def runtime_spec(self, directory: Path) -> TaggerRuntimeSpec:
        tag_count = len(self.load_vocabulary(directory).tags)
        return TaggerRuntimeSpec(
            backend="onnx",
            model_file="model.onnx",
            input=TaggerTensorSpec(name="input", shape=(None, 448, 448, 3)),
            outputs=(TaggerTensorSpec(name="output", shape=(None, tag_count)),),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=16,
                preferred_cpu=2,
                preferred_cuda=4,
            ),
            sample_shape=(448, 448, 3),
        )

    def profile_capabilities(self, directory: Path) -> TaggerProfileCapabilities:
        del directory
        return TaggerProfileCapabilities(
            supported_selection_modes=[
                TaggerSelectionMode.GLOBAL,
                TaggerSelectionMode.CATEGORY,
            ],
            default_selection=TaggerSelectionPolicy(
                mode=TaggerSelectionMode.CATEGORY,
                global_threshold=0.35,
                category_thresholds={
                    "general": 0.35,
                    "character": 0.85,
                    "rating": 0.5,
                },
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
                raise ValueError(f"WD v3 预处理结果形状或类型异常：{pixels.shape} / {pixels.dtype}")
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
        if not outputs:
            raise ValueError("WD v3 ONNX 没有返回概率。")
        probabilities = np.asarray(outputs[0], dtype=np.float32)
        if not np.all(np.isfinite(probabilities)) or np.any(
            (probabilities < 0.0) | (probabilities > 1.0)
        ):
            raise ValueError("WD v3 ONNX 返回了范围异常的概率。")
        return build_multilabel_results(
            probabilities,
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
                plan_id="wd_tagger_v3:swinv2_base_window8_256",
                adapter_id=self.id,
                name="WD Tagger v3 · SwinV2",
                model_version="v3-swinv2_base_window8_256",
                description="社区常用的 WD Tagger v3 SwinV2 ONNX 权重。",
                source_id="SmilingWolf/wd-swinv2-tagger-v3",
                revision="627aef95638667ddcaa3ac8ae625e88ea5b02f51",
                source_url="https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3",
                license_id="Apache-2.0",
                license_url=(
                    "https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/"
                    "tree/627aef95638667ddcaa3ac8ae625e88ea5b02f51"
                ),
                gated=False,
                provenance="author",
                files=(
                    TaggerRemoteFile(
                        remote_path="model.onnx",
                        relative_path="model.onnx",
                        size=467_460_978,
                        sha256="e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1",
                    ),
                    TaggerRemoteFile(
                        remote_path="selected_tags.csv",
                        relative_path="selected_tags.csv",
                        size=308_468,
                        sha256="298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217",
                    ),
                    TaggerRemoteFile(
                        remote_path="config.json",
                        relative_path="config.json",
                        size=637,
                        sha256="ddcdd28facc40ee8d0ef4b16ee3e7c70e4d7b156aff7b0f2ccc180e617eda795",
                    ),
                ),
            ),
        )


def _config_image_size(config: dict[str, object]) -> int | None:
    model_args = config.get("model_args")
    if isinstance(model_args, dict) and isinstance(model_args.get("img_size"), int):
        return int(model_args["img_size"])
    return None
