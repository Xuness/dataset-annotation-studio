from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

from dataset_studio.modules.tag_dictionaries.adapters.base import (
    DictionaryAdapterMixin,
    NormalizedDictionaryEntry,
    ValidatedDictionarySource,
)
from dataset_studio.modules.tag_dictionaries.models import TagDictionaryLicenseStatus

_CATEGORY_NAMES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta",
}
_INSERT_PREFIX = re.compile(
    r"""
    ^INSERT\s+OR\s+REPLACE\s+INTO\s+"danbooru_tag"\s*
    \(\s*"id_index"\s*,\s*"tag"\s*,\s*"color_id"\s*,\s*
    "translate"\s*,\s*"hot"\s*,\s*"aliases"\s*\)\s*
    VALUES\s*\((?P<values>.*)\)\s*;\s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)
_DATE_DIRECTORY = re.compile(r"^20\d{2}_\d{2}_\d{2}$")


class WeiLinPromptDictionaryAdapter(DictionaryAdapterMixin):
    id = "weilin_prompt"
    name = "WeiLin Prompt 数据库"
    description = "安全解析 WeiLin Prompt 仓库的 Danbooru SQL 数据，不执行远程 SQL。"
    contract_version = 1
    accepted_inputs = ("WeiLin Prompt 仓库 ZIP", "包含 danbooru SQL 的目录")
    source_id = "weilin9999/WeiLin-Comfyui-Tools-Prompt"
    source_url = "https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt"
    license_id = "MIT"
    license_url = "https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt/blob/master/LICENSE"
    license_status = TagDictionaryLicenseStatus.VERIFIED

    def detect(self, source: Path) -> bool:
        return bool(_sql_files(source))

    def validate(self, source: Path) -> ValidatedDictionarySource:
        files = _sql_files(source)
        if not files:
            raise ValueError("没有找到 WeiLin Danbooru SQL 文件。")
        count = 0
        for path in files:
            for _ in _read_sql_entries(path):
                count += 1
        if count <= 0:
            raise ValueError("WeiLin SQL 中没有可导入的有效词条。")
        source_version = next(
            (
                parent.name
                for path in files
                for parent in path.parents
                if _DATE_DIRECTORY.fullmatch(parent.name)
            ),
            f"{count}-entries",
        )
        return ValidatedDictionarySource(
            recommended_name=self.name,
            source_version=source_version,
            language="zh-CN",
            managed_files=tuple(files),
        )

    def entries(self, source: Path) -> Iterator[NormalizedDictionaryEntry]:
        files = _sql_files(source)
        if not files:
            raise ValueError("没有找到 WeiLin Danbooru SQL 文件。")
        for path in files:
            yield from _read_sql_entries(path)


def _sql_files(source: Path) -> list[Path]:
    if source.is_file():
        candidates = [source] if source.suffix.casefold() == ".sql" else []
    elif source.is_dir():
        candidates = sorted(
            path
            for path in source.rglob("*.sql")
            if path.is_file() and not path.is_symlink() and "danbooru" in path.as_posix().casefold()
        )
    else:
        candidates = []
    return [
        path
        for path in candidates
        if "danbooru_tag" in path.read_text(encoding="utf-8-sig", errors="ignore")[:4096]
    ]


def _read_sql_entries(path: Path) -> Iterator[NormalizedDictionaryEntry]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                line = raw_line.strip()
                if not line or line.startswith("--"):
                    continue
                match = _INSERT_PREFIX.fullmatch(line)
                if match is None:
                    raise ValueError(f"WeiLin SQL 第 {line_number} 行不是受支持的 INSERT。")
                values = _parse_values(match.group("values"), path, line_number)
                if len(values) != 6:
                    raise ValueError(f"WeiLin SQL 第 {line_number} 行字段数量不正确。")
                tag = str(values[1] or "").strip()
                translation = str(values[3] or "").strip()
                if not tag or not translation:
                    continue
                category_id = _as_int(values[2])
                aliases_value = values[5]
                aliases = (
                    tuple(
                        part.strip() for part in re.split(r"[,|;]", aliases_value) if part.strip()
                    )
                    if isinstance(aliases_value, str)
                    else ()
                )
                flags: list[str] = []
                if translation.casefold() == tag.casefold():
                    flags.append("same_as_source")
                if translation.count("-") >= 2:
                    flags.append("composite_translation")
                yield NormalizedDictionaryEntry(
                    tag=tag,
                    translation=translation,
                    raw_translation=translation,
                    category=_CATEGORY_NAMES.get(category_id, str(category_id))
                    if category_id is not None
                    else None,
                    post_count=_as_int(values[4]),
                    aliases=aliases,
                    quality_flags=tuple(flags),
                )
    except UnicodeDecodeError as error:
        raise ValueError(f"WeiLin SQL 不是有效 UTF-8：{path.name}") from error
    except OSError as error:
        raise ValueError(f"无法读取 WeiLin SQL：{path.name}") from error


def _parse_values(payload: str, path: Path, line_number: int) -> list[object]:
    values: list[object] = []
    token: list[str] = []
    quoted = False
    index = 0
    while index < len(payload):
        character = payload[index]
        if quoted:
            if character == "'" and index + 1 < len(payload) and payload[index + 1] == "'":
                token.append("'")
                index += 2
                continue
            if character == "'":
                quoted = False
            else:
                token.append(character)
            index += 1
            continue
        if character == "'":
            if "".join(token).strip():
                raise ValueError(f"WeiLin SQL 第 {line_number} 行字符串格式无效。")
            token.clear()
            quoted = True
            token.append("\0")
            index += 1
            continue
        if character == ",":
            values.append(_coerce_token(token, path, line_number))
            token.clear()
            index += 1
            continue
        token.append(character)
        index += 1
    if quoted:
        raise ValueError(f"WeiLin SQL 第 {line_number} 行字符串没有闭合。")
    values.append(_coerce_token(token, path, line_number))
    return values


def _coerce_token(token: list[str], path: Path, line_number: int) -> object:
    joined = "".join(token)
    if joined.startswith("\0"):
        return joined[1:]
    value = joined.strip()
    if value.upper() == "NULL":
        return None
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"WeiLin SQL {path.name} 第 {line_number} 行包含不支持的值。") from error


def _as_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
