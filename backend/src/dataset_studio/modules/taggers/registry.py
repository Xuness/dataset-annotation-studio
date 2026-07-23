from __future__ import annotations

from pathlib import Path

from dataset_studio.modules.taggers.adapters.anime_timm import AnimeTimmAdapter
from dataset_studio.modules.taggers.adapters.base import TaggerAdapter, ValidatedTaggerModel
from dataset_studio.modules.taggers.adapters.camie_v2 import CamieV2Adapter
from dataset_studio.modules.taggers.adapters.cl_tagger_v2 import CLTaggerV2Adapter
from dataset_studio.modules.taggers.adapters.joytag import JoyTagAdapter
from dataset_studio.modules.taggers.adapters.pixai_tagger_v09 import PixAITaggerV09Adapter
from dataset_studio.modules.taggers.adapters.wd_tagger_v3 import WDTaggerV3Adapter
from dataset_studio.modules.taggers.models import TaggerAdapterSummary


class TaggerAdapterRegistry:
    def __init__(self, adapters: tuple[TaggerAdapter, ...] | None = None) -> None:
        configured = adapters or (
            CLTaggerV2Adapter(),
            WDTaggerV3Adapter(),
            PixAITaggerV09Adapter(),
            JoyTagAdapter(),
            AnimeTimmAdapter(),
            CamieV2Adapter(),
        )
        self._adapters = {adapter.id: adapter for adapter in configured}
        if len(self._adapters) != len(configured):
            raise ValueError("本地打标器适配器 ID 不能重复。")

    def list(self) -> list[TaggerAdapterSummary]:
        return [
            TaggerAdapterSummary(
                id=adapter.id,
                name=adapter.name,
                description=adapter.description,
                contract_version=adapter.contract_version,
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

    def candidate_directories(
        self,
        root: Path,
        *,
        limit: int = 200,
    ) -> tuple[list[Path], bool]:
        markers = sorted(
            {marker for adapter in self._adapters.values() for marker in adapter.discovery_markers},
            key=str.casefold,
        )
        candidates: set[Path] = set()
        for marker in markers:
            for marker_path in root.rglob(marker):
                relative_parts = marker_path.relative_to(root).parts
                if any(part in {".staging", ".trash"} for part in relative_parts):
                    continue
                candidates.add(marker_path.parent.resolve())
                if len(candidates) >= limit:
                    return (
                        sorted(candidates, key=lambda path: str(path).casefold()),
                        True,
                    )
        return sorted(candidates, key=lambda path: str(path).casefold()), False
