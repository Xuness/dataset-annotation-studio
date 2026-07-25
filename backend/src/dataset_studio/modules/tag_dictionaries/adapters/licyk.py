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

_PREFERRED_NAMES = ("tag_pp_zh_new.csv",)


class LicykChineseAdapter(DictionaryAdapterMixin):
    id = "licyk_zh"
    name = "licyk 中英 CSV"
    description = "导入 tag_pp_zh_new.csv 或兼容的两列中英 Tag CSV。"
    contract_version = 1
    accepted_inputs = ("tag_pp_zh_new.csv", "兼容的两列 UTF-8 CSV")
    source_id = "licyk/tag_pp_zh_new.csv"
    source_url = "https://licyk.github.io/resources/tag_pp_zh_new.csv"
    license_id = "未声明"
    license_url = "https://github.com/licyk/licyk.github.io"
    license_status = TagDictionaryLicenseStatus.UNDECLARED

    def detect(self, source: Path) -> bool:
        csv_path = find_csv(source, _PREFERRED_NAMES)
        if csv_path is None:
            return False
        if csv_path.name.casefold() == "tags-zh-full-pack.csv":
            return False
        try:
            next(read_two_column_csv(csv_path))
        except (StopIteration, OSError, UnicodeError, ValueError):
            return False
        return True

    def validate(self, source: Path) -> ValidatedDictionarySource:
        csv_path = find_csv(source, _PREFERRED_NAMES)
        if csv_path is None:
            raise ValueError("没有找到可识别的两列中英 Tag CSV。")
        count = sum(1 for _ in read_two_column_csv(csv_path))
        if count <= 0:
            raise ValueError("中英 CSV 没有有效词条。")
        return ValidatedDictionarySource(
            recommended_name=self.name,
            source_version=f"{count}-entries",
            language="zh-CN",
            managed_files=(csv_path,),
        )

    def entries(self, source: Path) -> Iterator[NormalizedDictionaryEntry]:
        csv_path = find_csv(source, _PREFERRED_NAMES)
        if csv_path is None:
            raise ValueError("没有找到可识别的两列中英 Tag CSV。")
        yield from read_two_column_csv(csv_path)
