from __future__ import annotations

from pathlib import Path

from dataset_studio.modules.tag_dictionaries.adapters.base import TagDictionaryAdapter
from dataset_studio.modules.tag_dictionaries.adapters.ffdkj import FfdkjDictionaryAdapter
from dataset_studio.modules.tag_dictionaries.adapters.licyk import LicykChineseAdapter
from dataset_studio.modules.tag_dictionaries.adapters.tagcomplete_cn import (
    TagCompleteChineseAdapter,
)
from dataset_studio.modules.tag_dictionaries.adapters.weilin import (
    WeiLinPromptDictionaryAdapter,
)
from dataset_studio.modules.tag_dictionaries.models import TagDictionaryAdapterSummary


class TagDictionaryAdapterRegistry:
    def __init__(self, adapters: tuple[TagDictionaryAdapter, ...] | None = None) -> None:
        configured = adapters or (
            FfdkjDictionaryAdapter(),
            WeiLinPromptDictionaryAdapter(),
            TagCompleteChineseAdapter(),
            LicykChineseAdapter(),
        )
        self._adapters = {adapter.id: adapter for adapter in configured}
        if len(self._adapters) != len(configured):
            raise ValueError("本地 Tag 词典适配器 ID 不能重复。")

    def list(self) -> list[TagDictionaryAdapterSummary]:
        return [adapter.summary() for adapter in self._adapters.values()]

    def get(self, adapter_id: str) -> TagDictionaryAdapter:
        try:
            return self._adapters[adapter_id]
        except KeyError as error:
            raise ValueError(f"不支持的本地 Tag 词典适配器：{adapter_id}") from error

    def detect(self, source: Path) -> TagDictionaryAdapter:
        detected: list[TagDictionaryAdapter] = []
        errors: list[str] = []
        for adapter in self._adapters.values():
            try:
                if adapter.detect(source):
                    detected.append(adapter)
            except (OSError, ValueError) as error:
                errors.append(f"{adapter.name}：{error}")
        if not detected:
            suffix = f"（{'；'.join(errors)}）" if errors else ""
            raise ValueError(f"所选文件或目录不是受支持的本地 Tag 词典{suffix}。")
        # Specific filename/schema adapters precede the compatible CSV fallback.
        return detected[0]
