from __future__ import annotations

import re
import sqlite3
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
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class FfdkjDictionaryAdapter(DictionaryAdapterMixin):
    id = "ffdkj_danbooru_zh"
    name = "ffdkj Danbooru 中英表"
    description = "导入 ffdkj 发布的 tag.sqlite，保留 Danbooru 类别与热度。"
    contract_version = 1
    accepted_inputs = ("tag.sqlite", "包含 tag.sqlite 的目录")
    source_id = "ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
    source_url = "https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
    license_id = "未声明"
    license_url = source_url
    license_status = TagDictionaryLicenseStatus.UNDECLARED

    def detect(self, source: Path) -> bool:
        database = _find_database(source)
        if database is None:
            return False
        try:
            _find_tag_table(database)
        except ValueError:
            return False
        return True

    def validate(self, source: Path) -> ValidatedDictionarySource:
        database = _find_database(source)
        if database is None:
            raise ValueError("没有找到 ffdkj 的 tag.sqlite。")
        table = _find_tag_table(database)
        connection = _read_only(database)
        try:
            row = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
            count = int(row[0]) if row else 0
        except sqlite3.DatabaseError as error:
            raise ValueError("无法读取 ffdkj SQLite 词典内容。") from error
        finally:
            connection.close()
        if count <= 0:
            raise ValueError("ffdkj 数据库没有有效词条。")
        return ValidatedDictionarySource(
            recommended_name=self.name,
            source_version=f"{count}-entries",
            language="zh-CN",
            managed_files=(database,),
        )

    def entries(self, source: Path) -> Iterator[NormalizedDictionaryEntry]:
        database = _find_database(source)
        if database is None:
            raise ValueError("没有找到 ffdkj 的 tag.sqlite。")
        table = _find_tag_table(database)
        connection = _read_only(database)
        try:
            rows = connection.execute(
                f"""
                SELECT name, category, cn_name, post_count
                FROM "{table}"
                ORDER BY name
                """
            )
            for row in rows:
                tag = str(row[0] or "").strip()
                translation = str(row[2] or "").strip()
                if not tag or not translation:
                    continue
                category_id = _optional_int(row[1])
                yield NormalizedDictionaryEntry(
                    tag=tag,
                    translation=translation,
                    raw_translation=translation,
                    category=_CATEGORY_NAMES.get(category_id, str(category_id))
                    if category_id is not None
                    else None,
                    post_count=_optional_int(row[3]),
                )
        except sqlite3.DatabaseError as error:
            raise ValueError("无法读取 ffdkj SQLite 词典内容。") from error
        finally:
            connection.close()


def _find_database(source: Path) -> Path | None:
    if source.is_file():
        return source if source.suffix.casefold() in {".sqlite", ".sqlite3", ".db"} else None
    if not source.is_dir():
        return None
    preferred = sorted(
        path for path in source.rglob("tag.sqlite") if path.is_file() and not path.is_symlink()
    )
    if preferred:
        return preferred[0]
    candidates = sorted(
        path
        for path in source.rglob("*")
        if path.is_file() and path.suffix.casefold() in {".sqlite", ".sqlite3", ".db"}
    )
    return candidates[0] if candidates else None


def _read_only(path: Path) -> sqlite3.Connection:
    try:
        return sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)
    except sqlite3.DatabaseError as error:
        raise ValueError("无法读取 ffdkj SQLite 数据库。") from error


def _find_tag_table(path: Path) -> str:
    connection = _read_only(path)
    try:
        tables = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            ).fetchall()
        ]
        for table in tables:
            if not _SAFE_IDENTIFIER.fullmatch(table):
                continue
            columns = {
                str(row[1])
                for row in connection.execute(f'PRAGMA table_info("{table}")').fetchall()
            }
            if {"name", "category", "cn_name", "post_count"}.issubset(columns):
                return table
    except sqlite3.DatabaseError as error:
        raise ValueError("ffdkj SQLite 数据库结构无效。") from error
    finally:
        connection.close()
    raise ValueError("SQLite 中没有找到 ffdkj 词典表。")


def _optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
