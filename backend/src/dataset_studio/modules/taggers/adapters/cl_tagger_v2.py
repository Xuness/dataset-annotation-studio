from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from dataset_studio.modules.taggers.adapters.base import (
    TaggerVocabulary,
    ValidatedTaggerModel,
)
from dataset_studio.modules.taggers.models import TaggerInferenceResult, TaggerInferenceTag
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan

_REQUIRED_FILES = (
    "model.onnx",
    "model.onnx.data",
    "model_vocabulary.json",
    "model_metadata.json",
)
_OPTIONAL_FILES = ("model_tag_metrics.npz", "model_ood_ref.npz")
_CATEGORY_ALIASES = {
    "characters": "character",
    "character": "character",
    "general": "general",
    "generals": "general",
    "copyright": "copyright",
    "copyrights": "copyright",
    "meta": "meta",
    "rating": "rating",
    "ratings": "rating",
    "quality": "quality",
}


class CLTaggerV2Adapter:
    id = "cl_tagger_v2"
    name = "CL Tagger v2"
    description = "面向插画与动漫图片的 Danbooru 多标签 ONNX 打标器。"

    def detect(self, directory: Path) -> bool:
        return (directory / "model.onnx").is_file() and (
            directory / "model_vocabulary.json"
        ).is_file()

    def validate(self, directory: Path) -> ValidatedTaggerModel:
        root = directory.resolve()
        if not root.is_dir():
            raise ValueError("选择的打标器目录不存在。")
        missing = [name for name in _REQUIRED_FILES if not (root / name).is_file()]
        if missing:
            raise ValueError("缺少 CL Tagger v2 必需文件：" + "、".join(missing))
        for name in _REQUIRED_FILES:
            path = root / name
            if path.is_symlink():
                raise ValueError(f"模型文件不能是符号链接：{name}")
            if path.stat().st_size <= 0:
                raise ValueError(f"模型文件为空：{name}")

        vocabulary = self.load_vocabulary(root)
        metadata = _read_json_object(root / "model_metadata.json", "模型元数据")
        declared_tags = _find_integer(
            metadata,
            {"num_tags", "tag_count", "n_tags", "num_classes", "output_tags"},
        )
        if declared_tags is not None and declared_tags != len(vocabulary.tags):
            raise ValueError(
                f"模型元数据声明 {declared_tags} 个标签，但词表包含 {len(vocabulary.tags)} 个。"
            )
        _validate_onnx_graph(root / "model.onnx", len(vocabulary.tags), root)

        category_counts = dict(Counter(vocabulary.categories))
        version = _find_string(metadata, {"version", "model_version", "release_version"})
        if not version:
            version = root.name if root.name.casefold().startswith("v2") else "v2-unknown"
        managed_files = tuple(
            name for name in (*_REQUIRED_FILES, *_OPTIONAL_FILES) if (root / name).is_file()
        )
        return ValidatedTaggerModel(
            adapter_id=self.id,
            model_version=version,
            tag_count=len(vocabulary.tags),
            categories=category_counts,
            managed_files=managed_files,
        )

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary:
        payload = _read_json_object(directory / "model_vocabulary.json", "模型词表")
        raw_index = payload.get("idx_to_tag")
        if isinstance(raw_index, list):
            raw_tags = raw_index
        elif isinstance(raw_index, dict):
            indexed: list[tuple[int, object]] = []
            try:
                indexed = sorted((int(key), value) for key, value in raw_index.items())
            except (TypeError, ValueError) as error:
                raise ValueError("模型词表 idx_to_tag 包含非整数索引。") from error
            if [index for index, _ in indexed] != list(range(len(indexed))):
                raise ValueError("模型词表 idx_to_tag 的索引不连续。")
            raw_tags = [value for _, value in indexed]
        else:
            raise ValueError("模型词表缺少 idx_to_tag。")
        if not raw_tags or any(not isinstance(tag, str) or not tag for tag in raw_tags):
            raise ValueError("模型词表包含空标签或非字符串标签。")

        tags = tuple(str(tag) for tag in raw_tags)
        if len(tags) != len(set(tags)):
            raise ValueError("模型词表包含重复标签。")
        category_names = _category_names(payload.get("categories"))
        raw_mapping = payload.get("tag_to_category")
        mapping = raw_mapping if isinstance(raw_mapping, dict) else {}
        categories = tuple(_normalize_category(mapping.get(tag), category_names) for tag in tags)
        return TaggerVocabulary(tags=tags, categories=categories)

    def preprocess(self, image: Image.Image) -> np.ndarray:
        rgb = image.convert("RGB").resize((384, 384), Image.Resampling.BICUBIC)
        pixels = np.asarray(rgb, dtype=np.float32)
        normalized = (pixels / 255.0 - 0.5) / 0.5
        return np.ascontiguousarray(normalized.transpose(2, 0, 1))

    def batch_size_limit(self, directory: Path) -> int | None:
        try:
            import onnx
        except ImportError as error:
            raise ValueError("本地服务缺少 ONNX 模型校验组件。") from error
        try:
            model = onnx.load_model(directory / "model.onnx", load_external_data=False)
        except Exception as error:
            raise ValueError("无法读取 ONNX 模型批次信息。") from error
        inputs = {value.name: value for value in model.graph.input}
        input_info = inputs.get("pixel_values")
        if input_info is None:
            raise ValueError("ONNX 模型缺少 pixel_values 输入。")
        batch_dimension = _tensor_shape(input_info)[0]
        return batch_dimension

    def preferred_batch_size(self, execution_provider: str) -> int:
        if execution_provider == "CUDAExecutionProvider":
            return 4
        if execution_provider == "CPUExecutionProvider":
            return 2
        return 1

    def collate(self, prepared: Sequence[np.ndarray]) -> dict[str, np.ndarray]:
        if not prepared:
            raise ValueError("本地打标批次不能为空。")
        for pixels in prepared:
            if pixels.shape != (3, 384, 384) or pixels.dtype != np.float32:
                raise ValueError(
                    f"CL Tagger v2 预处理结果形状或类型异常：{pixels.shape} / {pixels.dtype}"
                )
        return {"pixel_values": np.ascontiguousarray(np.stack(prepared, axis=0))}

    def output_names(self) -> tuple[str, ...]:
        return ("logits",)

    def postprocess(
        self,
        outputs: Sequence[object],
        vocabulary: TaggerVocabulary,
        *,
        threshold: float,
        categories: tuple[str, ...],
        provider: str,
        inference_ms: float,
    ) -> list[TaggerInferenceResult | Exception]:
        if not outputs:
            raise ValueError("ONNX 本地推理没有返回 logits。")
        logits = np.asarray(outputs[0], dtype=np.float32)
        if logits.ndim != 2:
            raise ValueError(f"ONNX logits 形状异常：{tuple(logits.shape)}")
        if logits.shape[1] != len(vocabulary.tags):
            raise ValueError("ONNX 输出标签数与模型词表不一致。")

        enabled_mask = _category_mask(vocabulary.categories, categories)
        logit_threshold = float(np.log(threshold / (1.0 - threshold)))
        per_image_ms = inference_ms / max(logits.shape[0], 1)
        results: list[TaggerInferenceResult | Exception] = []
        for row in logits:
            selected_indices = np.flatnonzero(enabled_mask & (row >= logit_threshold))
            if selected_indices.size == 0:
                results.append(
                    ValueError("当前阈值与类别设置没有产生任何标签，请调整打标配置后重试。")
                )
                continue
            selected_logits = np.clip(row[selected_indices], -80.0, 80.0)
            probabilities = 1.0 / (1.0 + np.exp(-selected_logits))
            selected = [
                TaggerInferenceTag(
                    name=vocabulary.tags[int(index)],
                    category=vocabulary.categories[int(index)],
                    confidence=float(probability),
                )
                for index, probability in zip(
                    selected_indices,
                    probabilities,
                    strict=True,
                )
            ]
            selected.sort(key=lambda item: (-item.confidence, item.name.casefold()))
            results.append(
                TaggerInferenceResult(
                    content=", ".join(item.name for item in selected),
                    tags=selected,
                    provider=provider,
                    inference_ms=per_image_ms,
                    batch_size=logits.shape[0],
                    batch_inference_ms=inference_ms,
                )
            )
        return results

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]:
        # Remote plans are intentionally absent in v1. A future audited source can
        # add exact revisions and file paths here without changing model management.
        return ()


def _read_json_object(path: Path, label: str) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"无法读取{label}：{path.name}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{label}必须是 JSON 对象：{path.name}")
    return payload


def _category_names(value: object) -> dict[object, str]:
    names: dict[object, str] = {}
    if isinstance(value, list):
        for index, name in enumerate(value):
            if isinstance(name, str):
                names[index] = _canonical_category(name)
                names[str(index)] = _canonical_category(name)
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str):
                category = _canonical_category(item)
                names[key] = category
                try:
                    integer_key = int(key)
                except (TypeError, ValueError):
                    pass
                else:
                    names[integer_key] = category
                    names[str(integer_key)] = category
            elif isinstance(key, str) and isinstance(item, (int, float)):
                names[int(item)] = _canonical_category(key)
                names[str(int(item))] = _canonical_category(key)
    return names


def _normalize_category(value: object, names: dict[object, str]) -> str:
    if isinstance(value, (str, int, float)) and value in names:
        return names[value]
    if isinstance(value, str):
        return _canonical_category(value)
    if isinstance(value, (int, float)) and int(value) in names:
        return names[int(value)]
    return "unknown"


def _canonical_category(value: str) -> str:
    normalized = value.strip().casefold().replace(" ", "_")
    return _CATEGORY_ALIASES.get(normalized, normalized or "unknown")


@lru_cache(maxsize=16)
def _category_mask(
    vocabulary_categories: tuple[str, ...],
    enabled_categories: tuple[str, ...],
) -> np.ndarray:
    enabled = frozenset(enabled_categories)
    mask = np.fromiter(
        (category in enabled for category in vocabulary_categories),
        dtype=np.bool_,
        count=len(vocabulary_categories),
    )
    mask.setflags(write=False)
    return mask


def _find_integer(value: object, keys: set[str]) -> int | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).casefold() in keys and not isinstance(item, bool):
                try:
                    return int(item)
                except (TypeError, ValueError):
                    pass
        for item in value.values():
            found = _find_integer(item, keys)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_integer(item, keys)
            if found is not None:
                return found
    return None


def _find_string(value: object, keys: set[str]) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).casefold() in keys and isinstance(item, (str, int, float)):
                return str(item).strip() or None
        for item in value.values():
            found = _find_string(item, keys)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_string(item, keys)
            if found:
                return found
    return None


def _validate_onnx_graph(model_path: Path, tag_count: int, root: Path) -> None:
    try:
        import onnx
    except ImportError as error:
        raise ValueError("本地服务缺少 ONNX 模型校验组件。") from error
    try:
        model = onnx.load_model(model_path, load_external_data=False)
    except Exception as error:
        raise ValueError("model.onnx 无法解析或已损坏。") from error

    inputs = {value.name: value for value in model.graph.input}
    outputs = {value.name: value for value in model.graph.output}
    if "pixel_values" not in inputs:
        raise ValueError("ONNX 模型缺少 pixel_values 输入。")
    if "logits" not in outputs:
        raise ValueError("ONNX 模型缺少 logits 输出。")
    input_shape = _tensor_shape(inputs["pixel_values"])
    if len(input_shape) != 4 or input_shape[1:] != (3, 384, 384):
        raise ValueError(f"pixel_values 输入形状不兼容：{input_shape}")
    if input_shape[0] not in (None, 1):
        raise ValueError(f"pixel_values 批次维度不兼容：{input_shape[0]}")
    if inputs["pixel_values"].type.tensor_type.elem_type != onnx.TensorProto.FLOAT:
        raise ValueError("pixel_values 输入类型必须是 float32。")
    output_shape = _tensor_shape(outputs["logits"])
    if len(output_shape) != 2:
        raise ValueError(f"logits 输出形状不兼容：{output_shape}")
    if output_shape[0] not in (None, 1):
        raise ValueError(f"logits 批次维度不兼容：{output_shape[0]}")
    if output_shape[1] is not None and output_shape[1] != tag_count:
        raise ValueError(f"ONNX 输出包含 {output_shape[1]} 个标签，但词表包含 {tag_count} 个。")
    if outputs["logits"].type.tensor_type.elem_type != onnx.TensorProto.FLOAT:
        raise ValueError("logits 输出类型必须是 float32。")

    external_locations: set[str] = set()
    for tensor in model.graph.initializer:
        for entry in tensor.external_data:
            if entry.key == "location" and entry.value:
                external_locations.add(entry.value)
    if external_locations != {"model.onnx.data"}:
        raise ValueError("ONNX 模型必须且只能引用同目录下的 model.onnx.data。")
    for location in external_locations:
        candidate = (root / location).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            raise ValueError(f"ONNX 外部权重文件不存在或路径越界：{location}")


def _tensor_shape(value_info) -> tuple[int | None, ...]:
    dimensions: list[int | None] = []
    for dimension in value_info.type.tensor_type.shape.dim:
        dimensions.append(int(dimension.dim_value) if dimension.HasField("dim_value") else None)
    return tuple(dimensions)
