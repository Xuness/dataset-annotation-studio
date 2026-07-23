from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from dataset_studio.modules.taggers.adapters.base import TaggerVocabulary
from dataset_studio.modules.taggers.models import (
    TaggerInferenceResult,
    TaggerInferenceTag,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
)


def probabilities_from_logits(logits: object) -> np.ndarray:
    values = np.asarray(logits, dtype=np.float32)
    return 1.0 / (1.0 + np.exp(-np.clip(values, -80.0, 80.0)))


def build_multilabel_results(
    probabilities: object,
    vocabulary: TaggerVocabulary,
    *,
    selection: TaggerSelectionPolicy,
    categories: tuple[str, ...],
    provider: str,
    inference_ms: float,
    exclusive_categories: frozenset[str] = frozenset(),
) -> list[TaggerInferenceResult | Exception]:
    scores = np.asarray(probabilities, dtype=np.float32)
    if scores.ndim != 2:
        raise ValueError(f"ONNX 输出形状异常：{tuple(scores.shape)}")
    if scores.shape[1] != len(vocabulary.tags):
        raise ValueError("ONNX 输出标签数与模型词表不一致。")
    if not np.all(np.isfinite(scores)) or np.any((scores < 0.0) | (scores > 1.0)):
        raise ValueError("ONNX 输出包含非有限值或范围异常的概率。")
    enabled = frozenset(categories)
    per_image_ms = inference_ms / max(scores.shape[0], 1)
    thresholds = _thresholds(vocabulary, selection)
    enabled_mask = np.fromiter(
        (category in enabled for category in vocabulary.categories),
        dtype=np.bool_,
        count=len(vocabulary.categories),
    )
    exclusive_indices = {
        category: np.flatnonzero(
            np.fromiter(
                (item == category for item in vocabulary.categories),
                dtype=np.bool_,
                count=len(vocabulary.categories),
            )
        )
        for category in exclusive_categories & enabled
    }
    results: list[TaggerInferenceResult | Exception] = []
    for row in scores:
        selected_mask = enabled_mask & (row >= thresholds)
        for category_indices in exclusive_indices.values():
            selected_mask[category_indices] = False
            if category_indices.size:
                best_index = int(category_indices[np.argmax(row[category_indices])])
                if row[best_index] >= thresholds[best_index]:
                    selected_mask[best_index] = True
        selected_indices = np.flatnonzero(selected_mask)
        if selected_indices.size == 0:
            results.append(
                ValueError("当前选择策略与类别设置没有产生任何标签，请调整打标配置后重试。")
            )
            continue
        selected = [
            TaggerInferenceTag(
                name=vocabulary.tags[int(index)],
                category=vocabulary.categories[int(index)],
                confidence=float(row[int(index)]),
            )
            for index in selected_indices
        ]
        selected.sort(key=lambda item: (-item.confidence, item.name.casefold()))
        if selection.max_tags is not None:
            selected = selected[: selection.max_tags]
        results.append(
            TaggerInferenceResult(
                content=", ".join(item.name for item in selected),
                tags=selected,
                provider=provider,
                inference_ms=per_image_ms,
                batch_size=scores.shape[0],
                batch_inference_ms=inference_ms,
            )
        )
    return results


def _thresholds(
    vocabulary: TaggerVocabulary,
    selection: TaggerSelectionPolicy,
) -> np.ndarray:
    recommended: Sequence[float | None] = vocabulary.recommended_thresholds or (None,) * len(
        vocabulary.tags
    )
    values: list[float] = []
    for category, tag_threshold in zip(
        vocabulary.categories,
        recommended,
        strict=True,
    ):
        threshold = selection.global_threshold
        if selection.mode in {
            TaggerSelectionMode.CATEGORY,
            TaggerSelectionMode.MODEL_RECOMMENDED,
        }:
            threshold = selection.category_thresholds.get(category, threshold)
        if selection.mode == TaggerSelectionMode.MODEL_RECOMMENDED and tag_threshold is not None:
            threshold = tag_threshold
        values.append(threshold)
    return np.asarray(values, dtype=np.float32)
