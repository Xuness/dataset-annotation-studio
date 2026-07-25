from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from dataset_studio.modules.tag_dictionaries.adapters.base import (
    DictionaryAdapterMixin,
    NormalizedDictionaryEntry,
    ValidatedDictionarySource,
)
from dataset_studio.modules.tag_dictionaries.adapters.csv_common import (
    find_csv,
    read_two_column_csv,
)
from dataset_studio.modules.tag_dictionaries.models import TagDictionaryLicenseStatus

_PREFERRED_NAMES = ("Tags-zh-full-pack.csv",)


class TagCompleteChineseAdapter(DictionaryAdapterMixin):
    id = "tagcomplete_cn"
    name = "TagComplete 中文整合包"
    description = "导入 Tags-zh-full-pack.csv 两列中英 Tag 文件。"
    contract_version = 1
    accepted_inputs = ("Tags-zh-full-pack.csv", "包含该 CSV 的目录")
    source_id = "byzod/a1111-sd-webui-tagcomplete-CN"
    source_url = "https://github.com/byzod/a1111-sd-webui-tagcomplete-CN"
    license_id = "MIT（内容来源混合）"
    license_url = "https://github.com/byzod/a1111-sd-webui-tagcomplete-CN/blob/main/LICENSE"
    license_status = TagDictionaryLicenseStatus.MIXED

    def detect(self, source: Path) -> bool:
        csv_path = find_csv(source, _PREFERRED_NAMES)
        return csv_path is not None and csv_path.name.casefold() == _PREFERRED_NAMES[0].casefold()

    def validate(self, source: Path) -> ValidatedDictionarySource:
        csv_path = find_csv(source, _PREFERRED_NAMES)
        if csv_path is None or csv_path.name.casefold() != _PREFERRED_NAMES[0].casefold():
            raise ValueError("没有找到 TagComplete 中文整合包 CSV。")
        count = sum(1 for _ in read_two_column_csv(csv_path))
        if count <= 0:
            raise ValueError("TagComplete 中文整合包没有有效词条。")
        return ValidatedDictionarySource(
            recommended_name=self.name,
            source_version=f"{count}-entries",
            language="zh-CN",
            managed_files=(csv_path,),
        )

    def entries(self, source: Path) -> Iterator[NormalizedDictionaryEntry]:
        csv_path = find_csv(source, _PREFERRED_NAMES)
        if csv_path is None:
            raise ValueError("没有找到 TagComplete 中文整合包 CSV。")
        yield from read_two_column_csv(csv_path)
