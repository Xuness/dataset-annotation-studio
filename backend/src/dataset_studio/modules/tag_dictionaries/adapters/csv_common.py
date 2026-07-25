from __future__ import annotations

import csv
from collections.abc import Iterator
from pathlib import Path

from dataset_studio.modules.tag_dictionaries.adapters.base import (
    NormalizedDictionaryEntry,
)


def find_csv(source: Path, preferred_names: tuple[str, ...] = ()) -> Path | None:
    if source.is_file():
        return source if source.suffix.casefold() == ".csv" and not source.is_symlink() else None
    if not source.is_dir():
        return None
    files = sorted(
        path for path in source.rglob("*.csv") if path.is_file() and not path.is_symlink()
    )
    preferred = {name.casefold() for name in preferred_names}
    return next(
        (path for path in files if path.name.casefold() in preferred),
        files[0] if files else None,
    )


def read_two_column_csv(path: Path) -> Iterator[NormalizedDictionaryEntry]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            for line_number, row in enumerate(reader, start=1):
                if not row or all(not value.strip() for value in row):
                    continue
                if len(row) < 2:
                    raise ValueError(f"词典 CSV 第 {line_number} 行少于两列。")
                tag = row[0].strip()
                translation = row[1].strip()
                if line_number == 1 and tag.casefold() in {"tag", "name", "english"}:
                    continue
                if not tag or not translation:
                    continue
                yield NormalizedDictionaryEntry(
                    tag=tag,
                    translation=translation,
                    raw_translation=translation,
                    quality_flags=("extra_columns",) if len(row) > 2 else (),
                )
    except UnicodeDecodeError as error:
        raise ValueError(f"词典 CSV 不是有效 UTF-8：{path.name}") from error
    except csv.Error as error:
        raise ValueError(f"词典 CSV 格式无效：{path.name}") from error
