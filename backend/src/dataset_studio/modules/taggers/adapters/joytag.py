from __future__ import annotations

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
    normalize_nchw,
    square_pad,
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

_REQUIRED_FILES = ("model.onnx", "top_tags.txt", "config.json")
_EXPECTED_TAG_COUNT = 5_813


class JoyTagAdapter:
    id = "joytag"
    name = "JoyTag"
    description = "JoyTag 官方 ONNX 包；词表没有标签类别，统一归入 general。"
    contract_version = 1
    discovery_markers = ("top_tags.txt",)

    def detect(self, directory: Path) -> bool:
        if not all((directory / name).is_file() for name in _REQUIRED_FILES):
            return False
        try:
            config = read_json_object(directory / "config.json", "JoyTag 配置")
        except ValueError:
            return False
        return (
            config.get("class") == "ViT"
            and config.get("image_size") == 448
            and config.get("n_tags") == _EXPECTED_TAG_COUNT
        )

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        managed_files = validate_managed_files(directory, _REQUIRED_FILES)
        config = read_json_object(directory / "config.json", "JoyTag 配置")
        if (
            config.get("class") != "ViT"
            or config.get("image_size") != 448
            or config.get("n_tags") != _EXPECTED_TAG_COUNT
        ):
            raise ValueError("JoyTag config.json 与官方 448px ONNX 包不兼容。")
        vocabulary = self.load_vocabulary(directory)
        if len(vocabulary.tags) != _EXPECTED_TAG_COUNT:
            raise ValueError(
                f"JoyTag 词表包含 {len(vocabulary.tags)} 个标签，预期 {_EXPECTED_TAG_COUNT} 个。"
            )
        return ValidatedTaggerModel(
            adapter_id=self.id,
            adapter_contract_version=self.contract_version,
            model_version="v1-onnx",
            tag_count=len(vocabulary.tags),
            categories={"general": len(vocabulary.tags)},
            profile_capabilities=self.profile_capabilities(directory),
            managed_files=managed_files,
        )

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary:
        try:
            tags = tuple(
                line.strip()
                for line in (directory / "top_tags.txt").read_text(encoding="utf-8").splitlines()
                if line.strip()
            )
        except (OSError, UnicodeError) as error:
            raise ValueError("无法读取 JoyTag top_tags.txt。") from error
        if not tags or len(tags) != len(set(tags)):
            raise ValueError("JoyTag 词表为空或包含重复标签。")
        return TaggerVocabulary(
            tags=tags,
            categories=("general",) * len(tags),
        )

    def preprocess(self, directory: Path, image: Image.Image) -> np.ndarray:
        del directory
        prepared = square_pad(image).resize((448, 448), Image.Resampling.BICUBIC)
        return normalize_nchw(
            prepared,
            mean=(0.48145466, 0.4578275, 0.40821073),
            std=(0.26862954, 0.26130258, 0.27577711),
        )

    def runtime_spec(self, directory: Path) -> TaggerRuntimeSpec:
        tag_count = len(self.load_vocabulary(directory).tags)
        return TaggerRuntimeSpec(
            backend="onnx",
            model_file="model.onnx",
            input=TaggerTensorSpec(name="input", shape=(None, 3, 448, 448)),
            outputs=(TaggerTensorSpec(name="output", shape=(None, tag_count)),),
            batch=TaggerBatchContract(
                mode="dynamic",
                max_size=16,
                preferred_cpu=2,
                preferred_cuda=4,
            ),
            sample_shape=(3, 448, 448),
        )

    def profile_capabilities(self, directory: Path) -> TaggerProfileCapabilities:
        del directory
        return TaggerProfileCapabilities(
            supported_selection_modes=[TaggerSelectionMode.GLOBAL],
            default_selection=TaggerSelectionPolicy(
                mode=TaggerSelectionMode.GLOBAL,
                global_threshold=0.4,
            ),
            default_categories=["general"],
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
                    f"JoyTag 预处理结果形状或类型异常：{pixels.shape} / {pixels.dtype}"
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
        if not outputs:
            raise ValueError("JoyTag ONNX 没有返回 logits。")
        return build_multilabel_results(
            probabilities_from_logits(outputs[0]),
            vocabulary,
            selection=selection,
            categories=categories,
            provider=provider,
            inference_ms=inference_ms,
        )

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]:
        return (
            TaggerDownloadPlan(
                plan_id="joytag:v1_onnx",
                adapter_id=self.id,
                name="JoyTag · ONNX",
                model_version="v1-onnx",
                description="JoyTag 的官方 ONNX 导出与完整标签表。",
                source_id="fancyfeast/joytag",
                revision="6b7f16331a6ccf0fdce37d5a9564715f6e772b22",
                source_url="https://huggingface.co/fancyfeast/joytag",
                license_id="Apache-2.0",
                license_url=(
                    "https://huggingface.co/fancyfeast/joytag/"
                    "tree/6b7f16331a6ccf0fdce37d5a9564715f6e772b22"
                ),
                gated=False,
                provenance="author",
                files=(
                    TaggerRemoteFile(
                        remote_path="model.onnx",
                        relative_path="model.onnx",
                        size=366_116_154,
                        sha256="f85b7130e6e549b5b0822537007b7482e8c4c8e754c8d9a5bee08e27050e1097",
                    ),
                    TaggerRemoteFile(
                        remote_path="top_tags.txt",
                        relative_path="top_tags.txt",
                        size=76_752,
                        sha256="32b1963a234af848643b2bbf47d8eff1f1c7889406810c57b980f41b2b9e01d0",
                    ),
                    TaggerRemoteFile(
                        remote_path="config.json",
                        relative_path="config.json",
                        size=330,
                        sha256="b53ee29a8f0d6353331f455fd640c70ef45e5bd979b656f7b9983cffa3724562",
                    ),
                ),
            ),
        )
