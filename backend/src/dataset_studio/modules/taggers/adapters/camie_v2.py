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
    read_json_object,
    validate_managed_files,
)
from dataset_studio.modules.taggers.adapters.common.image_preprocessing import (
    fit_with_padding,
    normalize_nchw,
)
from dataset_studio.modules.taggers.adapters.common.multilabel import (
    build_multilabel_results,
    probabilities_from_logits,
)
from dataset_studio.modules.taggers.models import (
    TaggerInferenceResult,
    TaggerProfileCapabilities,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
)
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan, TaggerRemoteFile

_REQUIRED_FILES = (
    "camie-tagger-v2.onnx",
    "camie-tagger-v2-metadata.json",
    "config.json",
)
_EXPECTED_TAG_COUNT = 70_527
_EXPECTED_CATEGORIES = {
    "general",
    "rating",
    "meta",
    "year",
    "character",
    "artist",
    "copyright",
}


class CamieV2Adapter:
    id = "camie_tagger_v2"
    name = "Camie Tagger v2"
    description = "Camie v2 官方 ONNX 包，支持 refined 多输出与 70527 标签。"
    contract_version = 1
    discovery_markers = ("camie-tagger-v2-metadata.json",)

    def detect(self, directory: Path) -> bool:
        if not all((directory / name).is_file() for name in _REQUIRED_FILES):
            return False
        try:
            metadata = read_json_object(
                directory / "camie-tagger-v2-metadata.json",
                "Camie v2 元数据",
            )
        except ValueError:
            return False
        model_info = metadata.get("model_info")
        dataset_info = metadata.get("dataset_info")
        return (
            isinstance(model_info, dict)
            and model_info.get("img_size") == 512
            and isinstance(dataset_info, dict)
            and dataset_info.get("total_tags") == _EXPECTED_TAG_COUNT
        )

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        managed_files = validate_managed_files(directory, _REQUIRED_FILES)
        config = read_json_object(directory / "config.json", "Camie v2 配置")
        models = config.get("models")
        if (
            config.get("default_model") != "camie-tagger-v2-onnx"
            or not isinstance(models, list)
            or not any(
                isinstance(model, dict)
                and model.get("name") == "camie-tagger-v2-onnx"
                and model.get("path") == "camie-tagger-v2.onnx"
                for model in models
            )
        ):
            raise ValueError("Camie v2 config.json 没有声明受支持的 ONNX 模型。")
        metadata = _load_metadata(directory)
        _validate_metadata_contract(metadata)
        vocabulary = self.load_vocabulary(directory)
        if len(vocabulary.tags) != _EXPECTED_TAG_COUNT:
            raise ValueError(
                f"Camie v2 词表包含 {len(vocabulary.tags)} 个标签，预期 {_EXPECTED_TAG_COUNT} 个。"
            )
        categories = dict(Counter(vocabulary.categories))
        if set(categories) != _EXPECTED_CATEGORIES:
            raise ValueError("Camie v2 词表的七类标签不完整。")
        version = config.get("version")
        version_label = str(version).strip() if version is not None else "unknown"
        return ValidatedTaggerModel(
            adapter_id=self.id,
            adapter_contract_version=self.contract_version,
            model_version=f"v2-{version_label}",
            tag_count=len(vocabulary.tags),
            categories=categories,
            profile_capabilities=self.profile_capabilities(directory),
            managed_files=managed_files,
        )

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary:
        metadata = _load_metadata(directory)
        dataset_info = metadata.get("dataset_info")
        if not isinstance(dataset_info, dict):
            raise ValueError("Camie v2 元数据缺少 dataset_info。")
        mapping = dataset_info.get("tag_mapping")
        if not isinstance(mapping, dict):
            raise ValueError("Camie v2 元数据缺少 tag_mapping。")
        raw_index = mapping.get("idx_to_tag")
        raw_categories = mapping.get("tag_to_category")
        if not isinstance(raw_index, dict) or not isinstance(raw_categories, dict):
            raise ValueError("Camie v2 元数据缺少索引词表或标签类别映射。")
        indexed: list[tuple[int, str]] = []
        try:
            for key, value in raw_index.items():
                if not isinstance(value, str) or not value:
                    raise ValueError
                indexed.append((int(key), value))
        except (TypeError, ValueError) as error:
            raise ValueError("Camie v2 idx_to_tag 包含无效索引或标签。") from error
        indexed.sort(key=lambda item: item[0])
        if [index for index, _ in indexed] != list(range(len(indexed))):
            raise ValueError("Camie v2 idx_to_tag 的索引不连续。")
        tags = tuple(tag for _, tag in indexed)
        if not tags or len(tags) != len(set(tags)):
            raise ValueError("Camie v2 词表为空或包含重复标签。")
        categories: list[str] = []
        for tag in tags:
            category = raw_categories.get(tag)
            if not isinstance(category, str):
                raise ValueError(f"Camie v2 标签缺少类别：{tag}")
            normalized = category.strip().casefold()
            if normalized not in _EXPECTED_CATEGORIES:
                raise ValueError(f"Camie v2 标签包含未知类别：{category}")
            categories.append(normalized)
        return TaggerVocabulary(tags=tags, categories=tuple(categories))

    def preprocess(self, directory: Path, image: Image.Image) -> np.ndarray:
        del directory
        prepared = fit_with_padding(
            image,
            512,
            background=(124, 116, 104),
            resample=Image.Resampling.LANCZOS,
        )
        return normalize_nchw(
            prepared,
            mean=(0.485, 0.456, 0.406),
            std=(0.229, 0.224, 0.225),
        )

    def runtime_spec(self, directory: Path) -> TaggerRuntimeSpec:
        del directory
        return TaggerRuntimeSpec(
            backend="onnx",
            model_file="camie-tagger-v2.onnx",
            input=TaggerTensorSpec(name="input", shape=(None, 3, 512, 512)),
            outputs=(
                TaggerTensorSpec(
                    name="initial_predictions",
                    shape=(None, _EXPECTED_TAG_COUNT),
                ),
                TaggerTensorSpec(
                    name="refined_predictions",
                    shape=(None, _EXPECTED_TAG_COUNT),
                ),
                TaggerTensorSpec(
                    name="selected_candidates",
                    shape=(None, 256),
                    dtype="int64",
                ),
            ),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=2,
                preferred_cpu=1,
                preferred_cuda=1,
            ),
            sample_shape=(3, 512, 512),
        )

    def profile_capabilities(self, directory: Path) -> TaggerProfileCapabilities:
        del directory
        return TaggerProfileCapabilities(
            supported_selection_modes=[
                TaggerSelectionMode.GLOBAL,
                TaggerSelectionMode.CATEGORY,
            ],
            default_selection=TaggerSelectionPolicy(
                mode=TaggerSelectionMode.GLOBAL,
                global_threshold=0.5,
            ),
            default_categories=[
                "general",
                "character",
                "copyright",
                "artist",
                "meta",
            ],
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
                    f"Camie v2 预处理结果形状或类型异常：{pixels.shape} / {pixels.dtype}"
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
            raise ValueError("Camie v2 ONNX 没有返回完整的三项输出。")
        refined_probabilities = probabilities_from_logits(outputs[1])
        return build_multilabel_results(
            refined_probabilities,
            vocabulary,
            selection=selection,
            categories=categories,
            provider=provider,
            inference_ms=inference_ms,
            exclusive_categories=frozenset({"rating", "year"}),
        )

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]:
        return (
            TaggerDownloadPlan(
                plan_id="camie_tagger_v2:v2_1_0_0",
                adapter_id=self.id,
                name="Camie Tagger v2",
                model_version="v2-1.0.0",
                description="Camie Tagger v2 的精炼预测 ONNX 权重与标签元数据。",
                source_id="Camais03/camie-tagger-v2",
                revision="7d40c1b85b86ab4f607b2caf26b1b50c99db743e",
                source_url="https://huggingface.co/Camais03/camie-tagger-v2",
                license_id="GPL-3.0",
                license_url=(
                    "https://huggingface.co/Camais03/camie-tagger-v2/"
                    "tree/7d40c1b85b86ab4f607b2caf26b1b50c99db743e"
                ),
                gated=False,
                provenance="author",
                files=(
                    TaggerRemoteFile(
                        remote_path="camie-tagger-v2.onnx",
                        relative_path="camie-tagger-v2.onnx",
                        size=788_983_561,
                        sha256="ab0aaf253e3d546090001bec9bebc776c354ab6800f442ab9167af87b4a953ac",
                    ),
                    TaggerRemoteFile(
                        remote_path="camie-tagger-v2-metadata.json",
                        relative_path="camie-tagger-v2-metadata.json",
                        size=7_771_946,
                        sha256="de9f962eb0fd86b7e30d0af4e8c7990205200d70e955d8ecae60f87d14eae66b",
                    ),
                    TaggerRemoteFile(
                        remote_path="config.json",
                        relative_path="config.json",
                        size=527,
                        sha256="4fcb331e5b98c7b99649114a26ef677ed1aaeff0623da4693a74bce1ff99a433",
                    ),
                ),
            ),
        )


def _load_metadata(directory: Path) -> dict[str, object]:
    return read_json_object(
        directory / "camie-tagger-v2-metadata.json",
        "Camie v2 元数据",
    )


def _validate_metadata_contract(metadata: dict[str, object]) -> None:
    model_info = metadata.get("model_info")
    dataset_info = metadata.get("dataset_info")
    input_spec = metadata.get("input_spec")
    output_spec = metadata.get("output_spec")
    if (
        not isinstance(model_info, dict)
        or model_info.get("img_size") != 512
        or not isinstance(dataset_info, dict)
        or dataset_info.get("total_tags") != _EXPECTED_TAG_COUNT
        or set(dataset_info.get("categories", [])) != _EXPECTED_CATEGORIES
        or not isinstance(input_spec, dict)
        or input_spec.get("shape") != [3, 512, 512]
        or input_spec.get("dtype") != "float32"
        or not isinstance(output_spec, dict)
        or set(output_spec)
        != {
            "initial_predictions",
            "refined_predictions",
            "selected_candidates",
        }
    ):
        raise ValueError("Camie v2 元数据的输入、输出或标签契约不兼容。")
