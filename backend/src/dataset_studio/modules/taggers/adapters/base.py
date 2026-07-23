from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

from dataset_studio.modules.taggers.models import TaggerInferenceResult
from dataset_studio.modules.taggers.sources.base import TaggerDownloadPlan


@dataclass(frozen=True, slots=True)
class TaggerVocabulary:
    tags: tuple[str, ...]
    categories: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ValidatedTaggerModel:
    adapter_id: str
    model_version: str
    tag_count: int
    categories: dict[str, int]
    managed_files: tuple[str, ...]
    warnings: tuple[str, ...] = ()


class TaggerAdapter(Protocol):
    id: str
    name: str
    description: str

    def detect(self, directory: Path) -> bool: ...

    def validate(self, directory: Path) -> ValidatedTaggerModel: ...

    def load_vocabulary(self, directory: Path) -> TaggerVocabulary: ...

    def preprocess(self, image: Image.Image) -> np.ndarray: ...

    def batch_size_limit(self, directory: Path) -> int | None: ...

    def preferred_batch_size(self, execution_provider: str) -> int: ...

    def collate(self, prepared: Sequence[np.ndarray]) -> dict[str, np.ndarray]: ...

    def output_names(self) -> tuple[str, ...]: ...

    def postprocess(
        self,
        outputs: Sequence[object],
        vocabulary: TaggerVocabulary,
        *,
        threshold: float,
        categories: tuple[str, ...],
        provider: str,
        inference_ms: float,
    ) -> list[TaggerInferenceResult | Exception]: ...

    def download_plans(self) -> tuple[TaggerDownloadPlan, ...]: ...
