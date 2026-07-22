from __future__ import annotations

from pathlib import Path

from dataset_studio.modules.taggers.adapters.base import TaggerAdapter, ValidatedTaggerModel
from dataset_studio.modules.taggers.adapters.cl_tagger_v2 import CLTaggerV2Adapter
from dataset_studio.modules.taggers.models import TaggerAdapterSummary


class TaggerAdapterRegistry:
    def __init__(self, adapters: tuple[TaggerAdapter, ...] | None = None) -> None:
        configured = adapters or (CLTaggerV2Adapter(),)
        self._adapters = {adapter.id: adapter for adapter in configured}
        if len(self._adapters) != len(configured):
            raise ValueError("本地打标器适配器 ID 不能重复。")

    def list(self) -> list[TaggerAdapterSummary]:
        return [
            TaggerAdapterSummary(
                id=adapter.id,
                name=adapter.name,
                description=adapter.description,
            )
            for adapter in self._adapters.values()
        ]

    def get(self, adapter_id: str) -> TaggerAdapter:
        try:
            return self._adapters[adapter_id]
        except KeyError as error:
            raise ValueError(f"当前版本不支持打标器适配器：{adapter_id}") from error

    def detect(self, directory: Path) -> tuple[TaggerAdapter, ValidatedTaggerModel]:
        detected = [adapter for adapter in self._adapters.values() if adapter.detect(directory)]
        if not detected:
            raise ValueError("所选目录不是当前版本支持的本地打标器模型。")
        if len(detected) > 1:
            raise ValueError("所选目录同时匹配多个打标器适配器，无法安全导入。")
        adapter = detected[0]
        return adapter, adapter.validate(directory)
